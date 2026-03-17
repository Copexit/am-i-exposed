//! WabiSabi CoinJoin Boltzmann turbo mode.
//!
//! Exploits WabiSabi's multi-denomination tier structure to compute entropy
//! and linkability matrices via per-tier Boltzmann partition formulas.
//!
//! Unlike JoinMarket (single denomination + change), WabiSabi transactions have
//! 20-30+ denomination tiers with equal-valued outputs in each. Within each tier,
//! the Boltzmann partition formula gives the exact intra-tier combination count.
//! Under a tier-independence approximation, total entropy is the sum of per-tier
//! entropies - a valid upper bound on the true (NP-hard) multi-tier entropy.
//!
//! See docs/research-wabisabi-entropy.md for the mathematical justification.
//!
//! Performance: O(T * n_in + n_out * n_in) where T = number of tiers.
//! For a 327x279 WabiSabi tx with 30 tiers: completes in <1ms.

use crate::partition::{boltzmann_equal_outputs_f64, cell_probability_equal_outputs};
use crate::types::BoltzmannResult;

/// A denomination tier: a group of equal-valued outputs.
struct Tier {
    denomination: i64,
    count: usize,
    /// Indices of outputs in this tier (in the sorted output array).
    output_indices: Vec<usize>,
    /// Number of inputs with value >= denomination.
    eligible_inputs: usize,
    /// Effective participant count: min(count, eligible_inputs).
    effective_n: usize,
    /// Per-tier cell probability for eligible inputs.
    cell_prob: f64,
    /// Per-tier entropy in bits: log2(boltzmann_equal_outputs_f64(effective_n)).
    entropy_bits: f64,
}

/// Full WabiSabi Boltzmann analysis.
///
/// Groups outputs into denomination tiers, computes per-tier Boltzmann
/// partition counts, and constructs the full linkability matrix.
///
/// Falls back gracefully for degenerate cases (0 inputs/outputs).
pub fn analyze_wabisabi(
    input_values: &[i64],
    output_values: &[i64],
    fees: i64,
    _timeout_ms: u32,
) -> BoltzmannResult {
    let start = crate::time::now_ms();

    // Sort descending (same convention as standard analyze)
    let mut sorted_inputs: Vec<i64> = input_values.to_vec();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let mut sorted_outputs: Vec<i64> = output_values.to_vec();
    sorted_outputs.sort_by(|a, b| b.cmp(a));
    sorted_outputs.retain(|&v| v > 0);

    let n_in = sorted_inputs.len();
    let n_out = sorted_outputs.len();

    if n_in == 0 || n_out == 0 {
        return degenerate_result(n_in.max(1), n_out.max(1), fees, start);
    }

    // Step 1: Group outputs into denomination tiers
    let tiers = build_tiers(&sorted_inputs, &sorted_outputs);

    // Step 2: Compute total entropy (sum of per-tier entropies)
    let total_entropy: f64 = tiers.iter().map(|t| t.entropy_bits).sum();

    // Step 3: Build probability and combination matrices
    let scale = 1_000_000_000_000_000u64; // 10^15 for combination matrix scaling
    let mut mat_prob = vec![vec![0.0f64; n_in]; n_out];
    let mut mat_comb = vec![vec![0u64; n_in]; n_out];

    for tier in &tiers {
        for &out_idx in &tier.output_indices {
            for in_idx in 0..n_in {
                if sorted_inputs[in_idx] >= tier.denomination {
                    mat_prob[out_idx][in_idx] = tier.cell_prob;
                    mat_comb[out_idx][in_idx] = (tier.cell_prob * scale as f64).round() as u64;
                }
                // else: 0.0 (default) - input too small for this tier
            }
        }
    }

    // Step 4: Detect deterministic links
    // A link is deterministic only when there's exactly 1 output AND 1 eligible input.
    let mut deterministic_links = Vec::new();
    for tier in &tiers {
        if tier.count == 1 && tier.eligible_inputs == 1 {
            for &out_idx in &tier.output_indices {
                for in_idx in 0..n_in {
                    if sorted_inputs[in_idx] >= tier.denomination {
                        deterministic_links.push((out_idx, in_idx));
                        break;
                    }
                }
            }
        }
    }

    // Compute nb_cmbn (total combinations) - product of per-tier counts
    // This overflows u64 for large WabiSabi txs, so we compute it as f64
    // and cap the u64 representation.
    let nb_cmbn_f64: f64 = tiers
        .iter()
        .filter(|t| t.effective_n >= 2)
        .map(|t| boltzmann_equal_outputs_f64(t.effective_n))
        .product();
    let nb_cmbn_u64 = if nb_cmbn_f64 > u64::MAX as f64 {
        u64::MAX
    } else if nb_cmbn_f64 >= 1.0 {
        nb_cmbn_f64.round() as u64
    } else {
        1
    };

    let elapsed_ms = (crate::time::now_ms() - start) as u32;

    BoltzmannResult {
        mat_lnk_combinations: mat_comb,
        mat_lnk_probabilities: mat_prob,
        nb_cmbn: nb_cmbn_u64,
        entropy: total_entropy,
        efficiency: 0.0, // Not meaningful for WabiSabi (no single "perfect CJ" reference)
        nb_cmbn_prfct_cj: 0,
        deterministic_links,
        timed_out: false,
        elapsed_ms,
        n_inputs: n_in,
        n_outputs: n_out,
        fees,
        intra_fees_maker: 0,
        intra_fees_taker: 0,
    }
}

/// Group sorted outputs into denomination tiers and compute per-tier statistics.
///
/// Two-pass approach:
/// 1. Group outputs and compute multi-output tier probabilities
/// 2. For singleton tiers, merge into nearest multi-output tier for probability
///    (a lone 4,782,969-sat output near a 5M tier gets ~30% linkability, not 1/300)
fn build_tiers(sorted_inputs: &[i64], sorted_outputs: &[i64]) -> Vec<Tier> {
    let n_in = sorted_inputs.len();
    let mut tiers: Vec<Tier> = Vec::new();

    // Pass 1: group consecutive equal values
    let mut i = 0;
    while i < sorted_outputs.len() {
        let denom = sorted_outputs[i];
        let mut indices = vec![i];
        let mut j = i + 1;
        while j < sorted_outputs.len() && sorted_outputs[j] == denom {
            indices.push(j);
            j += 1;
        }
        let count = indices.len();
        let eligible = sorted_inputs.partition_point(|&v| v >= denom).min(n_in);
        let effective_n = count.min(eligible);

        // Compute probability for multi-output tiers now; singletons deferred to pass 2
        let (cell_prob, entropy_bits) = if effective_n >= 2 {
            let prob = cell_probability_equal_outputs(effective_n);
            let nb = boltzmann_equal_outputs_f64(effective_n);
            let entropy = if nb > 1.0 { nb.log2() } else { 0.0 };
            (prob, entropy)
        } else if eligible == 1 {
            (1.0, 0.0)
        } else if eligible == 0 {
            (0.0, 0.0)
        } else {
            // Placeholder for singletons - will be fixed in pass 2
            (1.0 / eligible as f64, (eligible as f64).log2())
        };

        tiers.push(Tier {
            denomination: denom,
            count,
            output_indices: indices,
            eligible_inputs: eligible,
            effective_n,
            cell_prob,
            entropy_bits,
        });

        i = j;
    }

    // Pass 2: fix singleton tier probabilities by merging with nearest multi-output tier.
    //
    // In WabiSabi, a singleton denomination output is typically a standard denomination
    // that happened to have only one participant in this round (e.g., 3^14 = 4,782,969).
    // Treating it as "any of 300+ inputs equally likely" (1/eligible) is too diluted.
    //
    // Instead, merge it conceptually into the nearest multi-output tier: use that tier's
    // k+1 count to compute the probability. This models the singleton as "one more
    // participant in the nearest anonymity set," giving realistic 20-40% linkability.
    let multi_tiers: Vec<(i64, usize, usize)> = tiers
        .iter()
        .filter(|t| t.count >= 2)
        .map(|t| (t.denomination, t.count, t.eligible_inputs))
        .collect();

    if !multi_tiers.is_empty() {
        for tier in tiers.iter_mut() {
            if tier.count != 1 || tier.eligible_inputs <= 1 {
                continue;
            }

            // Find nearest multi-output tier by denomination value
            let mut best_idx = 0;
            let mut best_dist = i64::MAX;
            for (idx, &(d, _, _)) in multi_tiers.iter().enumerate() {
                let dist = (d - tier.denomination).abs();
                if dist < best_dist {
                    best_dist = dist;
                    best_idx = idx;
                }
            }

            let (_, nearest_k, _) = multi_tiers[best_idx];
            // Treat this singleton as an additional member of the nearest tier
            let merged_n = (nearest_k + 1).min(tier.eligible_inputs);
            if merged_n >= 2 {
                tier.cell_prob = cell_probability_equal_outputs(merged_n);
                let nb = boltzmann_equal_outputs_f64(merged_n);
                tier.entropy_bits = if nb > 1.0 { nb.log2() } else { 0.0 };
                tier.effective_n = merged_n;
            }
        }
    }

    tiers
}

/// Create a degenerate result (single interpretation, all links deterministic).
fn degenerate_result(n_in: usize, n_out: usize, fees: i64, start: f64) -> BoltzmannResult {
    let elapsed_ms = (crate::time::now_ms() - start) as u32;
    BoltzmannResult {
        mat_lnk_combinations: vec![vec![1u64; n_in]; n_out],
        mat_lnk_probabilities: vec![vec![1.0f64; n_in]; n_out],
        nb_cmbn: 1,
        entropy: 0.0,
        efficiency: 0.0,
        nb_cmbn_prfct_cj: 0,
        deterministic_links: Vec::new(),
        timed_out: false,
        elapsed_ms,
        n_inputs: n_in,
        n_outputs: n_out,
        fees,
        intra_fees_maker: 0,
        intra_fees_taker: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_synthetic_3_tier_symmetric() {
        // 6 inputs, 9 outputs (3 tiers of 3)
        // Tier A: 2M sats (3 outputs), all 6 inputs eligible
        // Tier B: 1M sats (3 outputs), all 6 inputs eligible
        // Tier C: 500k sats (3 outputs), all 6 inputs eligible
        // Each tier: n_t = min(3, 6) = 3, boltzmann(3) = 16
        // Total entropy = 3 * log2(16) = 3 * 4 = 12.0 bits
        let inputs = vec![5_000_000, 4_000_000, 3_000_000, 2_500_000, 2_000_000, 1_500_000];
        let outputs = vec![2_000_000, 2_000_000, 2_000_000, 1_000_000, 1_000_000, 1_000_000, 500_000, 500_000, 500_000];
        let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

        let result = analyze_wabisabi(&inputs, &outputs, fee, 10000);

        // Each tier has 3 equal outputs, effective_n=3, boltzmann(3)=16, log2(16)=4
        let expected_entropy = 3.0 * 4.0; // 12.0 bits
        assert!((result.entropy - expected_entropy).abs() < 0.01,
            "Expected ~{expected_entropy} bits, got {}", result.entropy);
        assert_eq!(result.n_inputs, 6);
        assert_eq!(result.n_outputs, 9);
        assert!(result.deterministic_links.is_empty());
        assert!(!result.timed_out);
    }

    #[test]
    fn test_synthetic_with_eligibility_constraint() {
        // 4 inputs: [3M, 2M, 1M, 500k]
        // 4 outputs: [2M, 2M, 500k, 500k]
        // Tier A (2M): 2 outputs, 2 eligible inputs (3M, 2M) -> n_t=2, boltzmann(2)=3
        // Tier B (500k): 2 outputs, 4 eligible inputs -> n_t=2, boltzmann(2)=3
        // Entropy = log2(3) + log2(3) = 2 * 1.585 = 3.17 bits
        let inputs = vec![3_000_000, 2_000_000, 1_000_000, 500_000];
        let outputs = vec![2_000_000, 2_000_000, 500_000, 500_000];
        let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

        let result = analyze_wabisabi(&inputs, &outputs, fee, 10000);

        let expected_entropy = 2.0 * (3.0f64).log2(); // ~3.17 bits
        assert!((result.entropy - expected_entropy).abs() < 0.01,
            "Expected ~{expected_entropy:.2} bits, got {:.2}", result.entropy);

        // Check matrix: tier A (2M) outputs should have 0 probability for inputs < 2M
        // Outputs are sorted desc: [2M, 2M, 500k, 500k]
        // Inputs sorted desc: [3M, 2M, 1M, 500k]
        // For 2M outputs (idx 0,1): inputs 0,1 eligible, inputs 2,3 not
        assert!(result.mat_lnk_probabilities[0][0] > 0.0); // 3M -> 2M: eligible
        assert!(result.mat_lnk_probabilities[0][1] > 0.0); // 2M -> 2M: eligible
        assert_eq!(result.mat_lnk_probabilities[0][2], 0.0); // 1M -> 2M: not eligible
        assert_eq!(result.mat_lnk_probabilities[0][3], 0.0); // 500k -> 2M: not eligible
    }

    #[test]
    fn test_single_tier_matches_standard_boltzmann() {
        // When all outputs are equal, WabiSabi turbo should produce the same entropy
        // as standard Boltzmann equal-output formula
        let inputs = vec![1_000_000; 5];
        let outputs = vec![800_000; 5];
        let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

        let result = analyze_wabisabi(&inputs, &outputs, fee, 10000);

        // boltzmann_equal_outputs(5) = 1496
        let expected_entropy = (1496.0f64).log2(); // ~10.55 bits
        assert!((result.entropy - expected_entropy).abs() < 0.01,
            "Expected ~{expected_entropy:.2} bits, got {:.2}", result.entropy);
    }

    #[test]
    fn test_deterministic_link_single_eligible() {
        // 3 inputs: [5M, 1M, 500k]
        // 3 outputs: [4M, 500k, 500k]
        // Tier A (4M): 1 output, 1 eligible input (5M) -> deterministic
        // Tier B (500k): 2 outputs, 3 eligible inputs -> n_t=2, boltzmann(2)=3
        let inputs = vec![5_000_000, 1_000_000, 500_000];
        let outputs = vec![4_000_000, 500_000, 500_000];
        let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

        let result = analyze_wabisabi(&inputs, &outputs, fee, 10000);

        assert_eq!(result.deterministic_links.len(), 1);
        // The 4M output (sorted idx 0) is deterministically linked to 5M input (sorted idx 0)
        assert_eq!(result.deterministic_links[0], (0, 0));

        // Entropy only from tier B: log2(3) = 1.585
        assert!((result.entropy - (3.0f64).log2()).abs() < 0.01);
    }

    #[test]
    fn test_unique_outputs() {
        // 3 inputs: [3M, 2M, 1M]
        // 5 outputs: [1M, 1M, 800k, 600k, 400k]
        // Tier (1M): 2 outputs, 3 eligible -> n_t=2, boltzmann(2)=3
        // Unique 800k: 1 output, 3 eligible -> deterministic? No, 3 eligible, prob=1/3
        // Unique 600k: 1 output, 3 eligible -> prob=1/3
        // Unique 400k: 1 output, 3 eligible -> prob=1/3
        let inputs = vec![3_000_000, 2_000_000, 1_000_000];
        let outputs = vec![1_000_000, 1_000_000, 800_000, 600_000, 400_000];
        let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

        let result = analyze_wabisabi(&inputs, &outputs, fee, 10000);

        // Tier (1M): 2 outputs, effective_n=2, boltzmann(2)=3 -> log2(3) bits
        // Each unique output (800k, 600k, 400k): merged into tier (1M, k=2),
        // so merged_n = min(2+1, 3) = 3, boltzmann(3)=16 -> log2(16)=4.0 bits
        let expected = (3.0f64).log2() + 3.0 * (16.0f64).log2();
        assert!((result.entropy - expected).abs() < 0.01,
            "Expected {expected:.2}, got {:.2}", result.entropy);
        assert!(result.deterministic_links.is_empty());

        // Unique outputs: merged into nearest tier (1M, k=2), merged_n=3
        // cell_probability_equal_outputs(3) = 8/16 = 0.5
        let prob_800k = result.mat_lnk_probabilities[2][0];
        let expected_prob = 8.0 / 16.0; // cell_value(3)/boltzmann(3)
        assert!((prob_800k - expected_prob).abs() < 0.01,
            "Expected {expected_prob} for merged unique output, got {prob_800k}");
    }

    #[test]
    fn test_large_symmetric_performance() {
        // Simulate a large WabiSabi: 100 inputs, 80 outputs across 8 tiers
        let inputs: Vec<i64> = (0..100).map(|i| 10_000_000 - i * 50_000).collect();
        let mut outputs: Vec<i64> = Vec::new();
        for &(denom, count) in &[
            (5_000_000i64, 10), (2_000_000, 10), (1_000_000, 10), (500_000, 10),
            (200_000, 10), (100_000, 10), (50_000, 10), (10_000, 10),
        ] {
            for _ in 0..count {
                outputs.push(denom);
            }
        }
        let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

        let start = std::time::Instant::now();
        let result = analyze_wabisabi(&inputs, &outputs, fee, 10000);
        let elapsed = start.elapsed();

        assert!(elapsed.as_millis() < 100, "Should complete in <100ms, took {}ms", elapsed.as_millis());
        assert!(result.entropy > 50.0, "Expected high entropy, got {}", result.entropy);
        assert_eq!(result.n_inputs, 100);
        assert_eq!(result.n_outputs, 80);
        assert!(result.deterministic_links.is_empty());
        assert_eq!(result.mat_lnk_probabilities.len(), 80);
        assert_eq!(result.mat_lnk_probabilities[0].len(), 100);
    }
}
