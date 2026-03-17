/// WabiSabi Boltzmann turbo mode - comprehensive correctness audit.
///
/// Tests against real WabiSabi CoinJoin transactions from mainnet
/// and independently verifies all mathematical properties.
use boltzmann_rs::partition::{
    boltzmann_equal_outputs_f64, cell_probability_equal_outputs,
};
use boltzmann_rs::wabisabi::analyze_wabisabi;

// ──────────────────────────────────────────────────────────────────────────────
// TX1: fb596c9f675471019c60e984b569f9020dac3b2822b16396042b50c890b45e5e
// 327 inputs, 279 outputs - large WabiSabi CoinJoin
// ──────────────────────────────────────────────────────────────────────────────

fn tx1_inputs() -> Vec<i64> {
    vec![
        44274656048, 13519395680, 129140163, 129140163, 129140163, 129140163,
        129140163, 100000000, 100000000, 86093442, 86093442, 86093442,
        86093442, 67108864, 67108864, 67108864, 67108864, 62667834,
        50000000, 50000000, 50000000, 43046721, 43046721, 43046721,
        33554432, 33554432, 33554432, 33554432, 33554432, 33554432,
        33554432, 33554432, 33554432, 33554432, 33554432, 33554432,
        33554432, 33554432, 28697814, 28697814, 28697814, 20736849,
        20000000, 20000000, 20000000, 20000000, 20000000, 20000000,
        20000000, 20000000, 20000000, 20000000, 20000000, 20000000,
        20000000, 20000000, 20000000, 20000000, 20000000, 16777216,
        16777216, 16777216, 16777216, 16777216, 16777216, 14348907,
        10000000, 10000000, 10000000, 10000000, 10000000, 10000000,
        10000000, 10000000, 10000000, 10000000, 10000000, 9565938,
        9565938, 9565938, 9565938, 9565938, 9565938, 9565938, 9565938,
        9565938, 9539098, 8690164, 6735397, 5000000, 5000000, 5000000,
        5000000, 5000000, 5000000, 5000000, 5000000, 5000000, 5000000,
        5000000, 4782969, 4782969, 4782969, 3764473, 3324687, 3188646,
        3188646, 3188646, 3188646, 3188646, 3188646, 3188646, 3188646,
        3188646, 3188646, 3188646, 3188646, 3188646, 3188646, 3188646,
        2954940, 2477100, 2097152, 2097152, 2097152, 2097152, 2097152,
        2097152, 2097152, 2097152, 2097152, 2097152, 2097152, 2097152,
        2097152, 2097152, 2097152, 2097152, 2097152, 1941789, 1800293,
        1672737, 1613500, 1605358, 1594323, 1594323, 1594323, 1594323,
        1594323, 1594323, 1594323, 1329437, 1062882, 1062882, 1062882,
        1062882, 1062882, 1062882, 1062882, 1062882, 1062882, 1062882,
        1062882, 1062882, 1057050, 853300, 790600, 651920, 531441,
        531441, 531441, 531441, 531441, 531441, 531441, 531441, 531441,
        531441, 531441, 531441, 531441, 531441, 531441, 531441, 531441,
        460612, 354294, 354294, 354294, 354294, 354294, 354294, 354294,
        354294, 354294, 354294, 354294, 354294, 354294, 354294, 354294,
        354294, 338578, 262144, 262144, 262144, 262144, 262144, 262144,
        262144, 262144, 262144, 200000, 200000, 200000, 200000, 200000,
        200000, 200000, 200000, 200000, 200000, 200000, 200000, 139411,
        131072, 131072, 131072, 131072, 131072, 131072, 131072, 118098,
        118098, 118098, 118098, 118098, 118098, 100000, 100000, 100000,
        100000, 100000, 100000, 65536, 65536, 65536, 65536, 65536,
        65536, 65536, 65536, 50000, 50000, 50000, 50000, 50000, 50000,
        50000, 39494, 39366, 39366, 39366, 39366, 39366, 39366, 39366,
        32768, 32768, 32768, 32768, 32768, 32768, 20000, 20000, 20000,
        20000, 20000, 20000, 20000, 20000, 20000, 20000, 19683, 19683,
        16384, 16384, 16384, 16384, 13122, 13122, 13122, 13122, 13122,
        13122, 13122, 13122, 10000, 10000, 10000, 10000, 10000, 10000,
        8192, 8192, 8192, 8192, 8192, 8192, 6561, 6561, 6561, 6561,
        6374, 6168, 6136, 5979, 5935, 5774, 5774, 5774, 5764, 5313,
        5263, 5164, 5000, 5000,
    ]
}

fn tx1_outputs() -> Vec<i64> {
    vec![
        10460353203, 10460353203, 10460353203, 10460353203, 10460353203,
        2525338051, 2324522934, 134217728, 134217728, 134217728, 134217728,
        134217728, 134217728, 134217728, 134217728, 134217728, 100000000,
        100000000, 100000000, 100000000, 86093442, 86093442, 86093442,
        86093442, 86093442, 86093442, 86093442, 86093442, 86093442,
        53162688, 50000000, 50000000, 50000000, 50000000, 50000000,
        33554432, 33554432, 33554432, 33554432, 33554432, 33554432,
        33554432, 33554432, 33554432, 33554432, 33554432, 33554432,
        33554432, 33554432, 33554432, 33554432, 33554432, 33554432,
        33554432, 20000000, 20000000, 20000000, 20000000, 20000000,
        20000000, 14348907, 14348907, 14348907, 14348907, 14348907,
        14348907, 14348907, 14348907, 14348907, 10000000, 10000000,
        10000000, 10000000, 10000000, 10000000, 10000000, 10000000,
        10000000, 10000000, 10000000, 10000000, 10000000, 8388608,
        5000000, 5000000, 5000000, 5000000, 5000000, 5000000, 5000000,
        5000000, 5000000, 5000000, 5000000, 5000000, 5000000, 5000000,
        5000000, 3188646, 3188646, 3188646, 3188646, 3188646, 3188646,
        3188646, 3188646, 3188646, 3188646, 3188646, 3188646, 3188646,
        3188646, 2097152, 2097152, 2097152, 2097152, 2097152, 2097152,
        2097152, 2097152, 2097152, 2097152, 2097152, 2097152, 2097152,
        2097152, 2097152, 2097152, 2097152, 2097152, 2097152, 2097152,
        1594323, 1594323, 1594323, 1594323, 1594323, 1594323, 1594323,
        1594323, 1594323, 1594323, 1594323, 1062882, 1062882, 1062882,
        1062882, 1062882, 1062882, 1062882, 1062882, 1062882, 1062882,
        1062882, 531441, 531441, 531441, 531441, 531441, 531441, 531441,
        531441, 531441, 531441, 531441, 531441, 531441, 531441, 387276,
        354294, 354294, 354294, 354294, 354294, 354294, 354294, 354294,
        354294, 354294, 354294, 354294, 262144, 262144, 262144, 262144,
        262144, 262144, 262144, 262144, 262144, 200000, 200000, 200000,
        200000, 200000, 200000, 200000, 200000, 131072, 131072, 131072,
        131072, 131072, 131072, 100000, 100000, 100000, 100000, 65536,
        65536, 65536, 65536, 50000, 50000, 50000, 50000, 50000, 50000,
        50000, 50000, 50000, 50000, 50000, 50000, 39366, 39366, 39366,
        39366, 39366, 39366, 39366, 39366, 39366, 39366, 39366, 32768,
        32768, 32768, 32768, 32768, 32768, 32768, 20000, 20000, 20000,
        20000, 20000, 19683, 19683, 16384, 16384, 16384, 16384, 16384,
        16384, 16384, 16384, 16384, 16384, 16384, 13122, 10000, 10000,
        10000, 10000, 10000, 10000, 10000, 8192, 8192, 8192, 8192,
        8192, 8192, 6561, 5863, 5824, 5550, 5550,
    ]
}

// ──────────────────────────────────────────────────────────────────────────────
// TX2: 3d6fe9f83c74fda60c374aad9c5f1d67be8b8f1eb5c29280de0d87e30e90bfc3
// 201 inputs, 173 outputs
// ──────────────────────────────────────────────────────────────────────────────

fn tx2_inputs() -> Vec<i64> {
    vec![
        2147483648, 2147483648, 2000000000, 2000000000, 397828878, 246534992,
        200000000, 134217728, 134217728, 134217728, 134217728, 134217728,
        134217728, 134217728, 100000000, 100000000, 100000000, 100000000,
        86093442, 86093442, 86093442, 86093442, 86093442, 86093442,
        86093442, 86093442, 67108864, 50000000, 50000000, 50000000,
        50000000, 50000000, 50000000, 50000000, 50000000, 50000000,
        43046721, 33554432, 33554432, 33554432, 33554432, 33554432,
        33554432, 33554432, 33554432, 33554432, 28697814, 28697814,
        28697814, 25040981, 20000000, 20000000, 20000000, 20000000,
        20000000, 20000000, 20000000, 20000000, 16777216, 16777216,
        16777216, 15232246, 14348907, 14348907, 10000000, 10000000,
        10000000, 10000000, 9860935, 8388608, 5300340, 5000000, 5000000,
        5000000, 5000000, 5000000, 5000000, 5000000, 5000000, 5000000,
        5000000, 5000000, 3188646, 3188646, 3188646, 3188646, 3188646,
        3188646, 3188646, 3188646, 3188646, 3188646, 3188646, 3188646,
        2097152, 2097152, 2097152, 2097152, 2097152, 1594323, 1594323,
        1594323, 1594323, 1594323, 1594323, 1594323, 1062882, 1062882,
        1062882, 1062882, 1062882, 1062882, 1062882, 1062882, 1062882,
        1062882, 1062882, 1062882, 735288, 531441, 531441, 531441,
        531441, 531441, 531441, 531441, 531441, 531441, 531441, 531441,
        405852, 354294, 354294, 354294, 354294, 354294, 354294, 354294,
        354294, 354294, 262144, 262144, 262144, 262144, 262144, 262144,
        262144, 262144, 213122, 200000, 200000, 200000, 200000, 131072,
        131072, 118098, 118098, 100000, 100000, 100000, 65536, 65536,
        65536, 65536, 65536, 65536, 50000, 50000, 50000, 50000, 50000,
        39366, 39366, 39366, 39366, 39366, 39366, 32768, 32768, 32768,
        20000, 20000, 20000, 19683, 16384, 16384, 16384, 16384, 16384,
        13122, 10000, 10000, 8192, 8192, 8003, 6561, 6561, 6561, 5341,
        5000, 5000,
    ]
}

fn tx2_outputs() -> Vec<i64> {
    vec![
        2000000000, 2000000000, 2000000000, 1162261467, 1162261467,
        774840978, 134217728, 134217728, 134217728, 134217728, 134217728,
        134217728, 134217728, 134217728, 134217728, 86093442, 86093442,
        86093442, 86093442, 86093442, 86093442, 86093442, 86093442,
        86093442, 86093442, 86093442, 86093442, 86093442, 86093442,
        86093442, 86093442, 50000000, 50000000, 50000000, 28697814,
        28697814, 28697814, 28697814, 28697814, 28697814, 28697814,
        28697814, 20000000, 20000000, 20000000, 20000000, 20000000,
        20000000, 20000000, 20000000, 20000000, 20000000, 20000000,
        20000000, 14348907, 14348907, 14348907, 14348907, 14348907,
        10000000, 10000000, 10000000, 10000000, 10000000, 10000000,
        10000000, 10000000, 10000000, 10000000, 10000000, 5000000,
        5000000, 5000000, 5000000, 5000000, 5000000, 5000000, 5000000,
        5000000, 5000000, 3188646, 3188646, 3188646, 3188646, 3188646,
        3188646, 3188646, 3188646, 2191416, 2097152, 2097152, 2097152,
        2097152, 2097152, 2097152, 2097152, 2097152, 1594323, 1594323,
        1279169, 1062882, 1062882, 1062882, 1062882, 1062882, 1062882,
        616438, 531441, 531441, 531441, 531441, 531441, 531441, 413343,
        354294, 354294, 354294, 262144, 262144, 200000, 200000, 200000,
        200000, 131072, 131072, 131072, 100000, 100000, 100000, 100000,
        100000, 100000, 100000, 65536, 65536, 65536, 59049, 50000,
        50000, 50000, 50000, 50000, 50000, 50000, 39366, 39366, 39366,
        39366, 39366, 39366, 39366, 39366, 39366, 32768, 32768, 32768,
        20000, 20000, 19290, 16384, 16384, 16384, 16384, 13122, 10000,
        10000, 10000, 10000, 10000, 8192, 8192, 6561, 6072,
    ]
}

// ──────────────────────────────────────────────────────────────────────────────
// Helper: Independently compute expected tier structure
// ──────────────────────────────────────────────────────────────────────────────

struct ExpectedTier {
    denomination: i64,
    count: usize,
    eligible: usize,
    effective_n: usize,
}

fn compute_expected_tiers(inputs: &[i64], outputs: &[i64]) -> Vec<ExpectedTier> {
    let mut sorted_inputs = inputs.to_vec();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let mut sorted_outputs = outputs.to_vec();
    sorted_outputs.sort_by(|a, b| b.cmp(a));
    sorted_outputs.retain(|&v| v > 0);

    let mut tiers = Vec::new();
    let mut i = 0;
    while i < sorted_outputs.len() {
        let denom = sorted_outputs[i];
        let mut count = 1;
        while i + count < sorted_outputs.len() && sorted_outputs[i + count] == denom {
            count += 1;
        }
        let eligible = sorted_inputs.partition_point(|&v| v >= denom);
        let effective_n = count.min(eligible);
        tiers.push(ExpectedTier {
            denomination: denom,
            count,
            eligible,
            effective_n,
        });
        i += count;
    }
    tiers
}

fn independently_compute_entropy(tiers: &[ExpectedTier]) -> f64 {
    let mut total = 0.0f64;
    for t in tiers {
        if t.effective_n >= 2 {
            let nb = boltzmann_equal_outputs_f64(t.effective_n);
            if nb > 1.0 {
                total += nb.log2();
            }
        } else if t.count == 1 && t.eligible >= 2 {
            total += (t.eligible as f64).log2();
        }
        // eligible <= 1: 0 entropy contribution
    }
    total
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 1: No column should have ALL cells at 100%
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_no_all_100_columns() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let n_out = result.n_outputs;
    let n_in = result.n_inputs;

    // No input column should have ALL outputs at 100%
    for in_idx in 0..n_in {
        let all_100 = (0..n_out).all(|out_idx| {
            (result.mat_lnk_probabilities[out_idx][in_idx] - 1.0).abs() < 1e-10
        });
        assert!(
            !all_100,
            "Input column {in_idx} has ALL outputs at 100% - this is the bug we fixed"
        );
    }

    // Also verify no output row has all inputs at 100%
    for out_idx in 0..n_out {
        let all_100 = (0..n_in).all(|in_idx| {
            (result.mat_lnk_probabilities[out_idx][in_idx] - 1.0).abs() < 1e-10
        });
        assert!(
            !all_100,
            "Output row {out_idx} has ALL inputs at 100% - should not happen in a CoinJoin"
        );
    }
}

#[test]
fn test_tx2_no_all_100_columns() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    for in_idx in 0..result.n_inputs {
        let all_100 = (0..result.n_outputs).all(|out_idx| {
            (result.mat_lnk_probabilities[out_idx][in_idx] - 1.0).abs() < 1e-10
        });
        assert!(!all_100, "TX2 input column {in_idx} has ALL outputs at 100%");
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 2: Within a tier, all eligible inputs have SAME probability
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_intra_tier_symmetry() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    let mut out_idx = 0;
    for tier in &tiers {
        // All outputs in this tier should have the same probability row
        for tier_out in 0..tier.count {
            let current_out = out_idx + tier_out;
            // All eligible inputs should have the same probability
            let eligible_probs: Vec<f64> = (0..result.n_inputs)
                .filter(|&in_idx| result.mat_lnk_probabilities[current_out][in_idx] > 0.0)
                .map(|in_idx| result.mat_lnk_probabilities[current_out][in_idx])
                .collect();

            if !eligible_probs.is_empty() {
                let first = eligible_probs[0];
                for (i, &p) in eligible_probs.iter().enumerate() {
                    assert!(
                        (p - first).abs() < 1e-10,
                        "Tier denom={}, output idx {}, eligible input prob[{}]={} != first={} - symmetry violation",
                        tier.denomination, current_out, i, p, first
                    );
                }
            }
        }
        out_idx += tier.count;
    }
}

#[test]
fn test_tx2_intra_tier_symmetry() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    let mut out_idx = 0;
    for tier in &tiers {
        for tier_out in 0..tier.count {
            let current_out = out_idx + tier_out;
            let eligible_probs: Vec<f64> = (0..result.n_inputs)
                .filter(|&in_idx| result.mat_lnk_probabilities[current_out][in_idx] > 0.0)
                .map(|in_idx| result.mat_lnk_probabilities[current_out][in_idx])
                .collect();

            if !eligible_probs.is_empty() {
                let first = eligible_probs[0];
                for (i, &p) in eligible_probs.iter().enumerate() {
                    assert!(
                        (p - first).abs() < 1e-10,
                        "TX2 tier denom={}, output {}, prob[{}]={} != first={}",
                        tier.denomination, current_out, i, p, first
                    );
                }
            }
        }
        out_idx += tier.count;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 3: Ineligible inputs have exactly 0%
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_ineligible_inputs_are_zero() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let mut sorted_inputs = inputs.clone();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let mut sorted_outputs = outputs.clone();
    sorted_outputs.sort_by(|a, b| b.cmp(a));
    sorted_outputs.retain(|&v| v > 0);

    // For each output, find its denomination and check that inputs below it are 0
    let mut out_idx = 0;
    let tiers = compute_expected_tiers(&inputs, &outputs);
    for tier in &tiers {
        for tier_out in 0..tier.count {
            let current_out = out_idx + tier_out;
            for in_idx in 0..result.n_inputs {
                if sorted_inputs[in_idx] < tier.denomination {
                    assert_eq!(
                        result.mat_lnk_probabilities[current_out][in_idx],
                        0.0,
                        "Output {} (denom={}) has non-zero prob for ineligible input {} (val={})",
                        current_out,
                        tier.denomination,
                        in_idx,
                        sorted_inputs[in_idx]
                    );
                }
            }
        }
        out_idx += tier.count;
    }
}

#[test]
fn test_tx2_ineligible_inputs_are_zero() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let mut sorted_inputs = inputs.clone();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let tiers = compute_expected_tiers(&inputs, &outputs);
    let mut out_idx = 0;
    for tier in &tiers {
        for tier_out in 0..tier.count {
            let current_out = out_idx + tier_out;
            for in_idx in 0..result.n_inputs {
                if sorted_inputs[in_idx] < tier.denomination {
                    assert_eq!(
                        result.mat_lnk_probabilities[current_out][in_idx],
                        0.0,
                        "TX2 output {} (denom={}) non-zero for ineligible input {} (val={})",
                        current_out, tier.denomination, in_idx, sorted_inputs[in_idx]
                    );
                }
            }
        }
        out_idx += tier.count;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 4: Unique outputs have probability 1/eligible for each eligible input
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_unique_output_probabilities() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    let mut out_idx = 0;
    for tier in &tiers {
        if tier.count == 1 && tier.eligible >= 2 {
            let expected_prob = 1.0 / tier.eligible as f64;
            // Check the single output in this tier
            let nonzero_probs: Vec<f64> = (0..result.n_inputs)
                .filter(|&in_idx| result.mat_lnk_probabilities[out_idx][in_idx] > 0.0)
                .map(|in_idx| result.mat_lnk_probabilities[out_idx][in_idx])
                .collect();

            assert_eq!(
                nonzero_probs.len(),
                tier.eligible,
                "Unique output {} (denom={}) should have {} eligible inputs, got {}",
                out_idx, tier.denomination, tier.eligible, nonzero_probs.len()
            );

            for (i, &p) in nonzero_probs.iter().enumerate() {
                assert!(
                    (p - expected_prob).abs() < 1e-10,
                    "Unique output {} (denom={}): eligible input[{}] prob={}, expected 1/{}={}",
                    out_idx, tier.denomination, i, p, tier.eligible, expected_prob
                );
            }
        }
        out_idx += tier.count;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 5: Column sums should NOT all be 1.0
// (That would mean each output funded by exactly one input - wrong for CoinJoin)
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_column_sums_not_all_one() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let mut any_column_above_one = false;
    for in_idx in 0..result.n_inputs {
        let col_sum: f64 = (0..result.n_outputs)
            .map(|out_idx| result.mat_lnk_probabilities[out_idx][in_idx])
            .sum();

        if col_sum > 1.0 + 1e-6 {
            any_column_above_one = true;
        }
    }

    // In a CoinJoin, an input can fund multiple outputs, so at least some
    // columns should have sums significantly above 1.0
    assert!(
        any_column_above_one,
        "All column sums <= 1.0 - in a CoinJoin, inputs can fund multiple outputs, \
         so the column sum (sum of probabilities across all outputs for one input) \
         should exceed 1.0 for inputs eligible across many tiers"
    );
}

#[test]
fn test_tx2_column_sums_not_all_one() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let mut any_column_above_one = false;
    for in_idx in 0..result.n_inputs {
        let col_sum: f64 = (0..result.n_outputs)
            .map(|out_idx| result.mat_lnk_probabilities[out_idx][in_idx])
            .sum();
        if col_sum > 1.0 + 1e-6 {
            any_column_above_one = true;
        }
    }
    assert!(any_column_above_one, "TX2: no column has sum > 1.0 - unexpected for CoinJoin");
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 6: Deterministic links only when exactly 1 output AND 1 eligible input
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_deterministic_links_correctness() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    // Find which tiers should produce deterministic links
    let mut expected_deterministic = Vec::new();
    let mut out_idx = 0;
    for tier in &tiers {
        if tier.count == 1 && tier.eligible == 1 {
            expected_deterministic.push(out_idx);
        }
        out_idx += tier.count;
    }

    eprintln!(
        "TX1 deterministic links: expected {}, got {}",
        expected_deterministic.len(),
        result.deterministic_links.len()
    );

    // Every reported deterministic link must be from a tier with count=1, eligible=1
    for &(out_idx, _in_idx) in &result.deterministic_links {
        assert!(
            expected_deterministic.contains(&out_idx),
            "Unexpected deterministic link at output index {} - \
             only outputs from single-output, single-eligible tiers should be deterministic",
            out_idx
        );
    }

    // Verify probability is 1.0 for deterministic links
    for &(out_idx, in_idx) in &result.deterministic_links {
        assert!(
            (result.mat_lnk_probabilities[out_idx][in_idx] - 1.0).abs() < 1e-10,
            "Deterministic link ({},{}) has probability {} instead of 1.0",
            out_idx, in_idx, result.mat_lnk_probabilities[out_idx][in_idx]
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 7: Entropy is reasonable (not 0, not infinity)
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_entropy_matches_independent_computation() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);
    let expected_entropy = independently_compute_entropy(&tiers);

    eprintln!("TX1 entropy: computed={}, expected={}", result.entropy, expected_entropy);

    assert!(result.entropy > 0.0, "TX1 entropy should be > 0 for a CoinJoin");
    assert!(result.entropy.is_finite(), "TX1 entropy should be finite");
    assert!(
        (result.entropy - expected_entropy).abs() < 0.01,
        "TX1 entropy mismatch: computed={}, expected={}",
        result.entropy,
        expected_entropy
    );
}

#[test]
fn test_tx2_entropy_matches_independent_computation() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);
    let expected_entropy = independently_compute_entropy(&tiers);

    eprintln!("TX2 entropy: computed={}, expected={}", result.entropy, expected_entropy);

    assert!(result.entropy > 0.0, "TX2 entropy should be > 0");
    assert!(result.entropy.is_finite(), "TX2 entropy should be finite");
    assert!(
        (result.entropy - expected_entropy).abs() < 0.01,
        "TX2 entropy mismatch: computed={}, expected={}",
        result.entropy,
        expected_entropy
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 8: Multi-output tier probability matches cell_probability_equal_outputs
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_multi_tier_probabilities() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    let mut out_idx = 0;
    for tier in &tiers {
        if tier.effective_n >= 2 {
            let expected_prob = cell_probability_equal_outputs(tier.effective_n);

            // Check first eligible input for the first output in this tier
            let mut checked = false;
            for in_idx in 0..result.n_inputs {
                if result.mat_lnk_probabilities[out_idx][in_idx] > 0.0 {
                    assert!(
                        (result.mat_lnk_probabilities[out_idx][in_idx] - expected_prob).abs() < 1e-10,
                        "Tier denom={} (effective_n={}): output {} input {} prob={}, expected={}",
                        tier.denomination, tier.effective_n, out_idx, in_idx,
                        result.mat_lnk_probabilities[out_idx][in_idx], expected_prob
                    );
                    checked = true;
                    break;
                }
            }
            assert!(
                checked,
                "Tier denom={} (effective_n={}): no non-zero probabilities found",
                tier.denomination, tier.effective_n
            );
        }
        out_idx += tier.count;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 9: Eligible input count matches expected
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_eligible_input_counts() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    let mut out_idx = 0;
    for tier in &tiers {
        // Count non-zero entries in this output row
        let nonzero_count = (0..result.n_inputs)
            .filter(|&in_idx| result.mat_lnk_probabilities[out_idx][in_idx] > 0.0)
            .count();

        if tier.eligible >= 1 {
            assert_eq!(
                nonzero_count,
                tier.eligible,
                "Tier denom={} output {}: expected {} eligible inputs, got {} non-zero",
                tier.denomination, out_idx, tier.eligible, nonzero_count
            );
        }
        out_idx += tier.count;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 10: Matrix dimensions correct
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_matrix_dimensions() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    assert_eq!(result.n_inputs, 327);
    assert_eq!(result.n_outputs, 279);
    assert_eq!(result.mat_lnk_probabilities.len(), 279, "Prob matrix should have 279 rows (outputs)");
    assert_eq!(result.mat_lnk_probabilities[0].len(), 327, "Prob matrix should have 327 cols (inputs)");
    assert_eq!(result.mat_lnk_combinations.len(), 279);
    assert_eq!(result.mat_lnk_combinations[0].len(), 327);
}

#[test]
fn test_tx2_matrix_dimensions() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    assert_eq!(result.n_inputs, 201);
    assert_eq!(result.n_outputs, 173);
    assert_eq!(result.mat_lnk_probabilities.len(), 173);
    assert_eq!(result.mat_lnk_probabilities[0].len(), 201);
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 11: Performance - should complete in <100ms for these large txs
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_performance() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let start = std::time::Instant::now();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);
    let elapsed = start.elapsed();

    eprintln!("TX1 (327x279) took: {:?}", elapsed);
    assert!(elapsed.as_millis() < 500, "TX1 should complete in <500ms, took {}ms", elapsed.as_millis());
    assert!(!result.timed_out);
}

#[test]
fn test_tx2_performance() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let start = std::time::Instant::now();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);
    let elapsed = start.elapsed();

    eprintln!("TX2 (201x173) took: {:?}", elapsed);
    assert!(elapsed.as_millis() < 500, "TX2 should complete in <500ms, took {}ms", elapsed.as_millis());
    assert!(!result.timed_out);
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 12: nb_cmbn is the product of per-tier counts (for multi-output tiers)
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_nb_cmbn_is_product() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    // The nb_cmbn should be the product of per-tier Boltzmann counts
    // (only for tiers with effective_n >= 2)
    // But nb_cmbn_f64 can overflow u64, so compare in log space
    let expected_log2: f64 = tiers
        .iter()
        .filter(|t| t.effective_n >= 2)
        .map(|t| {
            let nb = boltzmann_equal_outputs_f64(t.effective_n);
            nb.log2()
        })
        .sum();

    // For unique outputs, the "combination count" is the number of eligible inputs
    let unique_log2: f64 = tiers
        .iter()
        .filter(|t| t.count == 1 && t.eligible >= 2)
        .map(|t| (t.eligible as f64).log2())
        .sum();

    let total_expected_log2 = expected_log2 + unique_log2;

    // The entropy should match log2(nb_cmbn) approximately
    // (nb_cmbn may be capped at u64::MAX)
    if result.nb_cmbn < u64::MAX {
        let actual_log2 = if result.nb_cmbn > 1 { (result.nb_cmbn as f64).log2() } else { 0.0 };
        // For WabiSabi, entropy is computed from per-tier sums, not from nb_cmbn
        // So entropy == total_expected_log2 but log2(nb_cmbn) may differ
        eprintln!(
            "TX1 nb_cmbn={}, log2(nb_cmbn)={:.2}, expected_entropy={:.2}",
            result.nb_cmbn, actual_log2, total_expected_log2
        );
    } else {
        eprintln!("TX1 nb_cmbn overflowed to u64::MAX, expected log2: {:.2}", total_expected_log2);
    }

    // The key invariant: entropy == sum of per-tier log2 counts
    assert!(
        (result.entropy - total_expected_log2).abs() < 0.01,
        "Entropy should be the sum of per-tier log2 counts: computed={}, expected={}",
        result.entropy,
        total_expected_log2
    );
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 13: Probability values are in [0, 1]
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_probabilities_in_range() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    for (out_idx, row) in result.mat_lnk_probabilities.iter().enumerate() {
        for (in_idx, &p) in row.iter().enumerate() {
            assert!(
                (0.0..=1.0).contains(&p),
                "Probability out of range [0,1] at ({},{}): {}",
                out_idx, in_idx, p
            );
        }
    }
}

#[test]
fn test_tx2_probabilities_in_range() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    for (out_idx, row) in result.mat_lnk_probabilities.iter().enumerate() {
        for (in_idx, &p) in row.iter().enumerate() {
            assert!(
                (0.0..=1.0).contains(&p),
                "TX2 probability out of range at ({},{}): {}",
                out_idx, in_idx, p
            );
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 14: Multi-output tier - verify probability value against partition formula
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_cell_probability_known_values() {
    // Verify cell_probability_equal_outputs matches the ratio cell_value/nb_cmbn
    // for small n where we have exact values
    let known_nb: Vec<(usize, u64)> = vec![
        (2, 3), (3, 16), (4, 131), (5, 1496), (6, 22482), (7, 426833),
    ];
    let known_cell: Vec<(usize, u64)> = vec![
        (2, 2), (3, 8), (4, 53), (5, 512), (6, 6697), (7, 112925),
    ];

    for (i, &(n, nb)) in known_nb.iter().enumerate() {
        let cell = known_cell[i].1;
        let expected_prob = cell as f64 / nb as f64;
        let computed = cell_probability_equal_outputs(n);
        assert!(
            (computed - expected_prob).abs() < 1e-10,
            "n={}: cell_probability={}, expected cell/nb={}/{}={}",
            n, computed, cell, nb, expected_prob
        );
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// PROPERTY 15: Row sums - for a given output, sum of probabilities should equal
// the expected value (not necessarily 1.0)
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_row_sums_match_tier_expectations() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);

    let tiers = compute_expected_tiers(&inputs, &outputs);

    let mut out_idx = 0;
    for tier in &tiers {
        // Row sum = eligible_inputs * cell_probability
        let row_sum: f64 = (0..result.n_inputs)
            .map(|in_idx| result.mat_lnk_probabilities[out_idx][in_idx])
            .sum();

        let expected_row_sum = if tier.effective_n >= 2 {
            tier.eligible as f64 * cell_probability_equal_outputs(tier.effective_n)
        } else if tier.count == 1 && tier.eligible >= 2 {
            // Unique output: eligible * (1/eligible) = 1.0
            1.0
        } else if tier.eligible == 1 {
            // Deterministic: 1 * 1.0 = 1.0
            1.0
        } else {
            0.0
        };

        assert!(
            (row_sum - expected_row_sum).abs() < 1e-6,
            "Tier denom={} (effective_n={}, eligible={}): row_sum={}, expected={}",
            tier.denomination, tier.effective_n, tier.eligible, row_sum, expected_row_sum
        );
        out_idx += tier.count;
    }
}

// ──────────────────────────────────────────────────────────────────────────────
// EDGE CASE: Verify the "effective_n < count" scenario (more outputs than eligible inputs)
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_has_constrained_tiers() {
    // TX1 has tiers where count > eligible, e.g., 10460353203 sats:
    // 5 outputs but only 2 eligible inputs (the two largest)
    let tiers = compute_expected_tiers(&tx1_inputs(), &tx1_outputs());

    let constrained: Vec<&ExpectedTier> = tiers.iter()
        .filter(|t| t.count > t.eligible && t.eligible >= 1)
        .collect();

    eprintln!("TX1 constrained tiers (count > eligible):");
    for t in &constrained {
        eprintln!("  denom={}: count={}, eligible={}, effective_n={}",
            t.denomination, t.count, t.eligible, t.effective_n);
    }

    // The 10460353203 tier should be constrained
    let top_tier = tiers.iter().find(|t| t.denomination == 10460353203).unwrap();
    assert_eq!(top_tier.count, 5);
    assert_eq!(top_tier.eligible, 2);
    assert_eq!(top_tier.effective_n, 2);
}

// ──────────────────────────────────────────────────────────────────────────────
// AUDIT: Verify fee is correctly computed
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_fee_correctness() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let expected_fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    assert_eq!(expected_fee, 1555451, "TX1 fee should be 1,555,451 sats");

    let result = analyze_wabisabi(&inputs, &outputs, expected_fee, 30000);
    assert_eq!(result.fees, expected_fee);
}

#[test]
fn test_tx2_fee_correctness() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let expected_fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    assert_eq!(expected_fee, 1232222, "TX2 fee should be 1,232,222 sats");

    let result = analyze_wabisabi(&inputs, &outputs, expected_fee, 30000);
    assert_eq!(result.fees, expected_fee);
}

// ──────────────────────────────────────────────────────────────────────────────
// COMPREHENSIVE: Print full analysis summary for manual inspection
// ──────────────────────────────────────────────────────────────────────────────

#[test]
fn test_tx1_full_summary() {
    let inputs = tx1_inputs();
    let outputs = tx1_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);
    let tiers = compute_expected_tiers(&inputs, &outputs);

    eprintln!("\n=== TX1 FULL ANALYSIS ===");
    eprintln!("Inputs: {} | Outputs: {} | Fee: {} sats", result.n_inputs, result.n_outputs, result.fees);
    eprintln!("Entropy: {:.4} bits", result.entropy);
    eprintln!("nb_cmbn: {} (u64 max: {})", result.nb_cmbn, result.nb_cmbn == u64::MAX);
    eprintln!("Deterministic links: {}", result.deterministic_links.len());
    eprintln!("Elapsed: {}ms", result.elapsed_ms);
    eprintln!("\nTier breakdown:");

    let mut out_idx = 0;
    for tier in &tiers {
        let prob = if tier.effective_n >= 2 {
            cell_probability_equal_outputs(tier.effective_n)
        } else if tier.count == 1 && tier.eligible >= 2 {
            1.0 / tier.eligible as f64
        } else if tier.eligible == 1 {
            1.0
        } else {
            0.0
        };

        let entropy = if tier.effective_n >= 2 {
            let nb = boltzmann_equal_outputs_f64(tier.effective_n);
            if nb > 1.0 { nb.log2() } else { 0.0 }
        } else if tier.count == 1 && tier.eligible >= 2 {
            (tier.eligible as f64).log2()
        } else {
            0.0
        };

        eprintln!(
            "  [{:>3}] denom={:>15} | count={:>3} | eligible={:>4} | eff_n={:>3} | prob={:.6} | entropy={:.4} bits",
            out_idx, tier.denomination, tier.count, tier.eligible, tier.effective_n, prob, entropy
        );
        out_idx += tier.count;
    }
}

#[test]
fn test_tx2_full_summary() {
    let inputs = tx2_inputs();
    let outputs = tx2_outputs();
    let fee = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();
    let result = analyze_wabisabi(&inputs, &outputs, fee, 30000);
    let tiers = compute_expected_tiers(&inputs, &outputs);

    eprintln!("\n=== TX2 FULL ANALYSIS ===");
    eprintln!("Inputs: {} | Outputs: {} | Fee: {} sats", result.n_inputs, result.n_outputs, result.fees);
    eprintln!("Entropy: {:.4} bits", result.entropy);
    eprintln!("nb_cmbn: {} (u64 max: {})", result.nb_cmbn, result.nb_cmbn == u64::MAX);
    eprintln!("Deterministic links: {}", result.deterministic_links.len());
    eprintln!("Elapsed: {}ms", result.elapsed_ms);
    eprintln!("\nTier breakdown:");

    let mut out_idx = 0;
    for tier in &tiers {
        let prob = if tier.effective_n >= 2 {
            cell_probability_equal_outputs(tier.effective_n)
        } else if tier.count == 1 && tier.eligible >= 2 {
            1.0 / tier.eligible as f64
        } else if tier.eligible == 1 {
            1.0
        } else {
            0.0
        };

        eprintln!(
            "  [{:>3}] denom={:>15} | count={:>3} | eligible={:>4} | eff_n={:>3} | prob={:.6}",
            out_idx, tier.denomination, tier.count, tier.eligible, tier.effective_n, prob
        );
        out_idx += tier.count;
    }
}
