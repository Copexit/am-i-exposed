//! JoinMarket CoinJoin Boltzmann turbo mode.
//!
//! Exploits JoinMarket's structure (each maker: 1 input -> 1 CJ output + 1 change)
//! to deterministically match inputs to change outputs, then solve only the reduced
//! problem (inputs vs equal-denomination CJ outputs) which is exponentially smaller.

use crate::analyze::{compute_intrafees, finalize_result, run_linker};
use crate::partition::{boltzmann_equal_outputs, cell_value_equal_outputs};
use crate::types::BoltzmannResult;

/// Result of matching JoinMarket inputs to their change outputs.
struct JoinMarketMatch {
    /// For each input (in sorted-descending order), the index of its matched
    /// change output in the full sorted output list, or None if unmatched.
    input_to_change: Vec<Option<usize>>,
    /// Indices of CJ-denomination outputs in the full sorted output list.
    cj_output_indices: Vec<usize>,
    /// Indices of unmatched change outputs (taker changes) in the full sorted output list.
    unmatched_change_indices: Vec<usize>,
}

/// Try to match JoinMarket inputs to their change outputs via residual analysis.
///
/// Allows up to `max_unmatched` change outputs to remain unmatched (taker changes).
/// Returns None if too many changes can't be matched.
fn match_joinmarket(
    sorted_inputs: &[i64],
    sorted_outputs: &[i64],
    denomination: i64,
    fees: i64,
    max_unmatched: usize,
) -> Option<JoinMarketMatch> {
    // Separate outputs into CJ and change
    let mut cj_output_indices = Vec::new();
    let mut change_output_indices = Vec::new();
    for (i, &v) in sorted_outputs.iter().enumerate() {
        if v == denomination {
            cj_output_indices.push(i);
        } else {
            change_output_indices.push(i);
        }
    }

    let n_cj = cj_output_indices.len();
    if n_cj < 2 {
        return None;
    }

    // Must have at least one change output for turbo to help
    if change_output_indices.is_empty() {
        return None;
    }

    // Tolerance: per-participant fee share + max maker fee (up to 2%) + buffer.
    // Generous enough to handle real-world JoinMarket maker fee diversity.
    let tolerance = (fees / n_cj as i64).abs() * 3
        + (denomination as f64 * 0.02) as i64
        + 5000;

    // Greedy match: for each change output, find closest unmatched input residual
    let mut input_to_change: Vec<Option<usize>> = vec![None; sorted_inputs.len()];
    let mut unmatched_change_indices = Vec::new();

    for &change_idx in &change_output_indices {
        let change_val = sorted_outputs[change_idx];
        let mut best_input: Option<usize> = None;
        let mut best_diff: i64 = i64::MAX;

        for (ii, &input_val) in sorted_inputs.iter().enumerate() {
            if input_to_change[ii].is_some() {
                continue;
            }
            let residual = input_val - denomination;
            if residual < 0 {
                continue;
            }
            let diff = (residual - change_val).abs();
            if diff <= tolerance && diff < best_diff {
                best_diff = diff;
                best_input = Some(ii);
            }
        }

        match best_input {
            Some(ii) => {
                input_to_change[ii] = Some(change_idx);
            }
            None => {
                unmatched_change_indices.push(change_idx);
                if unmatched_change_indices.len() > max_unmatched {
                    return None; // Too many unmatched changes
                }
            }
        }
    }

    Some(JoinMarketMatch {
        input_to_change,
        cj_output_indices,
        unmatched_change_indices,
    })
}

/// Full JoinMarket turbo Boltzmann analysis.
///
/// Falls back to standard `analyze()` if JM matching fails.
pub fn analyze_joinmarket(
    input_values: &[i64],
    output_values: &[i64],
    fees: i64,
    denomination: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> BoltzmannResult {
    let start = crate::time::now_ms();
    let n_in = input_values.len();

    // Sort descending (same as standard analyze)
    let mut sorted_inputs: Vec<i64> = input_values.to_vec();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let mut sorted_outputs: Vec<i64> = output_values.to_vec();
    sorted_outputs.sort_by(|a, b| b.cmp(a));
    sorted_outputs.retain(|&v| v > 0);

    let n_out = sorted_outputs.len();

    if n_in <= 1 || n_out == 0 {
        if n_out > 18 {
            let degenerate = crate::types::LinkerResult::new_degenerate(n_out.max(1), n_in.max(1));
            return finalize_result(&degenerate, n_in.max(1), n_out.max(1), fees, 0, 0, start);
        }
        return crate::analyze::analyze(
            input_values, output_values, fees, max_cj_intrafees_ratio, timeout_ms,
        );
    }

    // Step 1: Match inputs to change outputs
    // Allow up to 5 unmatched changes (multi-input taker)
    let jm = match match_joinmarket(&sorted_inputs, &sorted_outputs, denomination, fees, 5) {
        Some(m) => m,
        None => {
            // Guard: don't attempt standard analyze on large problems
            // (2^n_out aggregates can exhaust WASM memory for n_out > 18)
            if n_out > 18 {
                let degenerate = crate::types::LinkerResult::new_degenerate(n_out, n_in);
                return finalize_result(&degenerate, n_in, n_out, fees, 0, 0, start);
            }
            return crate::analyze::analyze(
                input_values, output_values, fees, max_cj_intrafees_ratio, timeout_ms,
            );
        }
    };

    // Step 2: Build adjusted inputs (subtract matched change)
    let mut adjusted: Vec<i64> = Vec::with_capacity(n_in);
    for (i, &val) in sorted_inputs.iter().enumerate() {
        if let Some(change_idx) = jm.input_to_change[i] {
            adjusted.push(val - sorted_outputs[change_idx]);
        } else {
            adjusted.push(val);
        }
    }

    // Sort adjusted inputs descending with stable tiebreak on original index
    let mut adj_indexed: Vec<(i64, usize)> = adjusted
        .iter()
        .enumerate()
        .map(|(i, &v)| (v, i))
        .collect();
    adj_indexed.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));

    let mut full_to_reduced_in: Vec<usize> = vec![0; n_in];
    for (reduced_idx, &(_, full_idx)) in adj_indexed.iter().enumerate() {
        full_to_reduced_in[full_idx] = reduced_idx;
    }

    let reduced_inputs: Vec<i64> = adj_indexed.iter().map(|&(v, _)| v).collect();

    // Reduced outputs: CJ denomination only (unmatched taker changes excluded)
    let n_cj = jm.cj_output_indices.len();
    let reduced_outputs: Vec<i64> = vec![denomination; n_cj];
    let reduced_fee: i64 = reduced_inputs.iter().sum::<i64>() - n_cj as i64 * denomination;

    if reduced_fee < 0 {
        if n_out > 18 {
            let degenerate = crate::types::LinkerResult::new_degenerate(n_out, n_in);
            return finalize_result(&degenerate, n_in, n_out, fees, 0, 0, start);
        }
        return crate::analyze::analyze(
            input_values, output_values, fees, max_cj_intrafees_ratio, timeout_ms,
        );
    }

    // Step 3: Solve reduced problem
    //
    // Formula shortcut conditions:
    // 1. n_in == n_cj: standard NxN perfect CoinJoin
    // 2. n_in == n_cj + 1: (N+1)xN case - empirically boltzmann(n+1,n) = boltzmann(n+1,n+1)
    //
    // Both cases require all adjusted inputs >= denomination and n_cj in [2,15].
    let min_adj = reduced_inputs.iter().copied().min().unwrap_or(0);
    // Allow 5% tolerance for adjusted inputs below denomination (rounding from fee splits)
    let denom_threshold = denomination - denomination / 20;
    let n_extra = if n_in > n_cj { n_in - n_cj } else { 0 };
    let use_formula = n_extra <= 1
        && min_adj >= denom_threshold
        && n_cj >= 2
        && n_in <= 15;

    let (nb_cmbn, cj_cell, timed_out, actual_fees_maker, actual_fees_taker) = if use_formula {
        // Formula shortcut: O(1) computation via partition formula
        // For n_in == n_cj: boltzmann(n, n)
        // For n_in == n_cj + 1: boltzmann(n+1, n) = boltzmann(n+1, n+1) = boltzmann(n_in)
        let formula_n = n_in;
        let nb = boltzmann_equal_outputs(formula_n);
        let cell = cell_value_equal_outputs(formula_n);
        (nb, cell, false, 0i64, 0i64)
    } else {
        // DFS path for non-uniform inputs or n_in > n_cj + 1
        let deadline = start + timeout_ms as f64;

        let result_no_intra = run_linker(
            &reduced_inputs, &reduced_outputs, reduced_fee, 0, 0, Some(deadline),
        );

        let (fees_maker, fees_taker) = if max_cj_intrafees_ratio > 0.0 {
            compute_intrafees(&reduced_outputs, max_cj_intrafees_ratio)
        } else {
            (0, 0)
        };

        let (reduced_result, fm, ft) =
            if fees_maker > 0 && !result_no_intra.timed_out {
                let result_intra = run_linker(
                    &reduced_inputs, &reduced_outputs, reduced_fee,
                    fees_maker, fees_taker, Some(deadline),
                );
                if result_intra.nb_cmbn > result_no_intra.nb_cmbn {
                    (result_intra, fees_maker, fees_taker)
                } else {
                    (result_no_intra, 0, 0)
                }
            } else {
                (result_no_intra, 0, 0)
            };

        // Extract cell value from row 0 (all rows identical for equal outputs)
        let cell = if !reduced_result.mat_lnk.is_empty() && !reduced_result.mat_lnk[0].is_empty() {
            reduced_result.mat_lnk[0][0]
        } else {
            1
        };

        (reduced_result.nb_cmbn, cell, reduced_result.timed_out, fm, ft)
    };

    // Step 4: Expand to full matrix
    let mut full_mat = vec![vec![0u64; n_in]; n_out];

    // CJ output rows: uniform cell value for all inputs
    for &full_out in &jm.cj_output_indices {
        for cell in full_mat[full_out].iter_mut() {
            *cell = cj_cell;
        }
    }

    // Matched change output rows: deterministic links
    for (full_in, opt_change) in jm.input_to_change.iter().enumerate() {
        if let Some(&change_out) = opt_change.as_ref() {
            full_mat[change_out][full_in] = nb_cmbn;
        }
    }

    // Unmatched taker change rows: link to all unmatched inputs equally
    // (the taker's change could come from any of their inputs)
    if !jm.unmatched_change_indices.is_empty() {
        let unmatched_inputs: Vec<usize> = (0..n_in)
            .filter(|&i| jm.input_to_change[i].is_none())
            .collect();
        if !unmatched_inputs.is_empty() {
            for &change_out in &jm.unmatched_change_indices {
                for &ui in &unmatched_inputs {
                    full_mat[change_out][ui] = nb_cmbn;
                }
            }
        }
    }

    let full_linker = crate::types::LinkerResult {
        mat_lnk: full_mat,
        nb_cmbn,
        timed_out,
    };

    finalize_result(
        &full_linker,
        n_in,
        n_out,
        fees,
        actual_fees_maker,
        actual_fees_taker,
        start,
    )
}
