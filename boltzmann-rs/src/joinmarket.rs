//! JoinMarket CoinJoin Boltzmann turbo mode.
//!
//! Exploits JoinMarket's structure (each maker: 1 input -> 1 CJ output + 1 change)
//! to deterministically match inputs to change outputs, then solve only the reduced
//! problem (inputs vs equal-denomination CJ outputs) which is exponentially smaller.

use crate::analyze::{compute_intrafees, finalize_result, run_linker};
use crate::partition::{
    boltzmann_equal_outputs, boltzmann_equal_outputs_f64,
    cell_probability_equal_outputs, cell_value_equal_outputs,
};
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

    if n_in == 0 || n_out == 0 {
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
    // Three paths:
    // A) Formula shortcut (n_extra <= 1, all adj >= denom): O(1) via partition formula
    // B) DFS path (n_extra > 1, n_in <= 25): exact via subset sum enumeration
    // C) Formula approximation (n_extra > 1, n_in > 25): approximate using n_cj-party model
    //
    // Path C is needed because DFS Aggregates::new allocates 2^n_in entries,
    // which is infeasible for n_in > 25 (~32 million entries and growing).
    let min_adj = reduced_inputs.iter().copied().min().unwrap_or(0);
    // Allow 5% tolerance for adjusted inputs below denomination (rounding from fee splits)
    let denom_threshold = denomination - denomination / 20;
    let n_extra = if n_in > n_cj { n_in - n_cj } else { 0 };
    let use_formula = n_extra <= 1
        && min_adj >= denom_threshold
        && n_cj >= 2;

    // DFS feasibility: Aggregates::new needs 1<<n_in entries
    let dfs_feasible = n_in <= 25;

    if use_formula {
        // Path A: Formula shortcut for n_extra <= 1
        let formula_n = n_in;
        if formula_n <= 15 {
            // Exact u64 path
            let nb_cmbn = boltzmann_equal_outputs(formula_n);
            let cj_cell = cell_value_equal_outputs(formula_n);
            return build_u64_result(n_in, n_out, &jm, nb_cmbn, cj_cell, fees, start);
        } else {
            // f64 path for large n where u64 overflows
            let nb_cmbn_f64 = boltzmann_equal_outputs_f64(formula_n);
            let cj_prob = cell_probability_equal_outputs(formula_n);
            return build_f64_result(n_in, n_out, &jm, nb_cmbn_f64, cj_prob, fees, start);
        }
    }

    if !dfs_feasible {
        // Path C: Formula approximation for large problems
        // Treat the CJ part as an n_cj-party CoinJoin (each maker + taker collectively)
        let nb_cmbn_f64 = boltzmann_equal_outputs_f64(n_cj);
        let cj_prob = cell_probability_equal_outputs(n_cj);
        return build_f64_result(n_in, n_out, &jm, nb_cmbn_f64, cj_prob, fees, start);
    }

    // Path B: DFS for non-uniform inputs with feasible n_in
    let deadline = start + timeout_ms as f64;

    let result_no_intra = run_linker(
        &reduced_inputs, &reduced_outputs, reduced_fee, 0, 0, Some(deadline),
    );

    let (fees_maker, fees_taker) = if max_cj_intrafees_ratio > 0.0 {
        compute_intrafees(&reduced_outputs, max_cj_intrafees_ratio)
    } else {
        (0, 0)
    };

    let (reduced_result, actual_fees_maker, actual_fees_taker) =
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

    let nb_cmbn = reduced_result.nb_cmbn;
    let timed_out = reduced_result.timed_out;

    // Extract per-input cell values from row 0 (all CJ rows identical by symmetry
    // of equal outputs, but different inputs may have different cell values).
    let empty_row: Vec<u64> = vec![];
    let reduced_cj_row = if !reduced_result.mat_lnk.is_empty() {
        &reduced_result.mat_lnk[0]
    } else {
        &empty_row
    };
    // Fallback uniform value if DFS row is empty
    let cj_cell_fallback = if !reduced_cj_row.is_empty() { reduced_cj_row[0] } else { 1 };

    // Maker CJ cell: each matched maker funded exactly 1 of n_cj identical outputs.
    // By symmetry, prob = 1/n_cj. Cell value = nb_cmbn / n_cj.
    let maker_cj_cell = if n_cj > 0 { nb_cmbn / n_cj as u64 } else { nb_cmbn };

    // Step 4: Expand to full matrix (u64 path)
    let mut full_mat = vec![vec![0u64; n_in]; n_out];

    // CJ output rows: per-input cell values from DFS, differentiated by maker/taker
    for &full_out in &jm.cj_output_indices {
        for full_in in 0..n_in {
            if jm.input_to_change[full_in].is_some() {
                // Matched maker: exactly 1/n_cj probability (exact)
                full_mat[full_out][full_in] = maker_cj_cell;
            } else if !reduced_cj_row.is_empty() {
                // Taker input: use per-input DFS cell value
                let reduced_in = full_to_reduced_in[full_in];
                full_mat[full_out][full_in] = reduced_cj_row[reduced_in];
            } else {
                full_mat[full_out][full_in] = cj_cell_fallback;
            }
        }
    }

    // Matched change output rows: deterministic links
    for (full_in, opt_change) in jm.input_to_change.iter().enumerate() {
        if let Some(&change_out) = opt_change.as_ref() {
            full_mat[change_out][full_in] = nb_cmbn;
        }
    }

    // Unmatched change rows: use per-input DFS cell value (ambiguous, not deterministic).
    // Setting 100% would be wrong: a single input can't fund multiple unmatched
    // changes simultaneously, and we don't have DFS data for these specific links.
    if !jm.unmatched_change_indices.is_empty() {
        let unmatched_inputs: Vec<usize> = (0..n_in)
            .filter(|&i| jm.input_to_change[i].is_none())
            .collect();
        if !unmatched_inputs.is_empty() {
            for &change_out in &jm.unmatched_change_indices {
                for &ui in &unmatched_inputs {
                    if !reduced_cj_row.is_empty() {
                        let reduced_in = full_to_reduced_in[ui];
                        full_mat[change_out][ui] = reduced_cj_row[reduced_in];
                    } else {
                        full_mat[change_out][ui] = cj_cell_fallback;
                    }
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

/// Build a BoltzmannResult using u64 cell values (exact path for small n).
fn build_u64_result(
    n_in: usize,
    n_out: usize,
    jm: &JoinMarketMatch,
    nb_cmbn: u64,
    cj_cell: u64,
    fees: i64,
    start: f64,
) -> BoltzmannResult {
    let n_cj = jm.cj_output_indices.len() as u64;
    // Maker CJ cell: each matched maker funded exactly 1 of n_cj identical outputs.
    // By symmetry, prob = 1/n_cj. Cell value = nb_cmbn / n_cj.
    let maker_cj_cell = if n_cj > 0 { nb_cmbn / n_cj } else { nb_cmbn };

    let mut full_mat = vec![vec![0u64; n_in]; n_out];

    for &full_out in &jm.cj_output_indices {
        for i in 0..n_in {
            if jm.input_to_change[i].is_some() {
                // Matched maker: exact 1/n_cj
                full_mat[full_out][i] = maker_cj_cell;
            } else {
                // Taker/unmatched: partition formula (approximate)
                full_mat[full_out][i] = cj_cell;
            }
        }
    }

    for (full_in, opt_change) in jm.input_to_change.iter().enumerate() {
        if let Some(&change_out) = opt_change.as_ref() {
            full_mat[change_out][full_in] = nb_cmbn;
        }
    }

    // Unmatched changes: use CJ cell value (ambiguous)
    if !jm.unmatched_change_indices.is_empty() {
        let unmatched_inputs: Vec<usize> = (0..n_in)
            .filter(|&i| jm.input_to_change[i].is_none())
            .collect();
        for &change_out in &jm.unmatched_change_indices {
            for &ui in &unmatched_inputs {
                full_mat[change_out][ui] = cj_cell;
            }
        }
    }

    let full_linker = crate::types::LinkerResult {
        mat_lnk: full_mat,
        nb_cmbn,
        timed_out: false,
    };

    finalize_result(&full_linker, n_in, n_out, fees, 0, 0, start)
}

/// Build a BoltzmannResult using f64 probabilities (for large n where u64 overflows,
/// or for the formula approximation path).
fn build_f64_result(
    n_in: usize,
    n_out: usize,
    jm: &JoinMarketMatch,
    nb_cmbn_f64: f64,
    cj_cell_prob: f64,
    fees: i64,
    start: f64,
) -> BoltzmannResult {
    let n_cj = jm.cj_output_indices.len();
    // For the combinations matrix, use a scaled denominator so tooltip count/total is meaningful
    let scale = if nb_cmbn_f64 <= 1e15 {
        nb_cmbn_f64.round().max(1.0) as u64
    } else {
        1_000_000_000_000_000u64 // 10^15
    };
    let cj_cell_comb = (cj_cell_prob * scale as f64).round() as u64;

    // Maker CJ probability: each matched maker funded exactly 1 of n_cj identical
    // outputs. By combinatorial symmetry, prob = 1/n_cj (exact).
    let maker_cj_prob = if n_cj > 0 { 1.0 / n_cj as f64 } else { 1.0 };
    let maker_cj_comb = (maker_cj_prob * scale as f64).round() as u64;

    let mut mat_comb = vec![vec![0u64; n_in]; n_out];
    let mut mat_prob = vec![vec![0.0f64; n_in]; n_out];

    // CJ output rows: differentiate matched maker vs taker inputs
    for &full_out in &jm.cj_output_indices {
        for i in 0..n_in {
            if jm.input_to_change[i].is_some() {
                // Matched maker: exact 1/n_cj
                mat_comb[full_out][i] = maker_cj_comb;
                mat_prob[full_out][i] = maker_cj_prob;
            } else {
                // Taker/unmatched: partition formula (approximate)
                mat_comb[full_out][i] = cj_cell_comb;
                mat_prob[full_out][i] = cj_cell_prob;
            }
        }
    }

    // Matched change output rows: deterministic
    for (full_in, opt_change) in jm.input_to_change.iter().enumerate() {
        if let Some(&change_out) = opt_change.as_ref() {
            mat_comb[change_out][full_in] = scale;
            mat_prob[change_out][full_in] = 1.0;
        }
    }

    // Unmatched change rows: use CJ cell probability (ambiguous)
    if !jm.unmatched_change_indices.is_empty() {
        let unmatched_inputs: Vec<usize> = (0..n_in)
            .filter(|&i| jm.input_to_change[i].is_none())
            .collect();
        for &change_out in &jm.unmatched_change_indices {
            for &ui in &unmatched_inputs {
                mat_comb[change_out][ui] = cj_cell_comb;
                mat_prob[change_out][ui] = cj_cell_prob;
            }
        }
    }

    // Deterministic links: only matched change outputs (1:1 input-to-change)
    let mut deterministic_links = Vec::new();
    for (full_in, opt_change) in jm.input_to_change.iter().enumerate() {
        if let Some(&change_out) = opt_change.as_ref() {
            deterministic_links.push((change_out, full_in));
        }
    }

    let entropy = if nb_cmbn_f64 > 1.0 { nb_cmbn_f64.log2() } else { 0.0 };
    let nb_cmbn_u64 = if nb_cmbn_f64 > u64::MAX as f64 { u64::MAX } else { nb_cmbn_f64.round() as u64 };
    let elapsed_ms = (crate::time::now_ms() - start) as u32;

    BoltzmannResult {
        mat_lnk_combinations: mat_comb,
        mat_lnk_probabilities: mat_prob,
        nb_cmbn: nb_cmbn_u64,
        entropy,
        efficiency: 0.0,
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
