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
/// Same as [`try_analyze_joinmarket`], but returns a degenerate result (every
/// cell 100%) when no model fits and exact analysis is infeasible. Kept for
/// native callers; the WASM export reports that case as an error instead.
pub fn analyze_joinmarket(
    input_values: &[i64],
    output_values: &[i64],
    fees: i64,
    denomination: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> BoltzmannResult {
    try_analyze_joinmarket(input_values, output_values, fees, denomination, max_cj_intrafees_ratio, timeout_ms)
        .unwrap_or_else(|| {
            let n_in = input_values.len().max(1);
            let n_out = output_values.iter().filter(|&&v| v > 0).count().max(1);
            let degenerate = crate::types::LinkerResult::new_degenerate(n_out, n_in);
            finalize_result(&degenerate, n_in, n_out, fees, 0, 0, crate::time::now_ms())
        })
}

/// JoinMarket turbo Boltzmann analysis.
///
/// Tries, in order: single-input maker matching (fast path), the multi-input
/// participant model, and exact `analyze()` when that is feasible. Returns
/// None when none of them applies (exact analysis would exhaust memory/time).
///
/// Model results (method "joinmarket") are estimates under the maker/taker
/// model, not Boltzmann enumerations: see [`into_model_estimate`].
pub fn try_analyze_joinmarket(
    input_values: &[i64],
    output_values: &[i64],
    fees: i64,
    denomination: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> Option<BoltzmannResult> {
    joinmarket_paths(input_values, output_values, fees, denomination, max_cj_intrafees_ratio, timeout_ms)
        .map(|r| if r.method == "joinmarket" { into_model_estimate(r) } else { r })
}

/// Model cells never show certainty (100%) or impossibility (0%).
const MODEL_MIN_PROB: f64 = 0.01;
const MODEL_MAX_PROB: f64 = 0.99;

/// Turn a maker-model result into an honest estimate. The model's forced links
/// (a change always matched to the same inputs) are not Boltzmann-deterministic:
/// merging participants into one sub-transaction breaks them (for 6cb2433f a
/// 5-input sub-transaction funds 2 denominations plus the 80.5M and 29.5M
/// changes). They move to `model_links`, and every cell is clamped away from
/// 0 and 1 so no consumer reads a model estimate as proof.
fn into_model_estimate(mut r: BoltzmannResult) -> BoltzmannResult {
    r.model_links = std::mem::take(&mut r.deterministic_links);
    for p in r.mat_lnk_probabilities.iter_mut().flatten() {
        *p = p.clamp(MODEL_MIN_PROB, MODEL_MAX_PROB);
    }
    r
}

fn joinmarket_paths(
    input_values: &[i64],
    output_values: &[i64],
    fees: i64,
    denomination: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> Option<BoltzmannResult> {
    let start = crate::time::now_ms();
    let n_in = input_values.len();

    // Sort descending (same as standard analyze)
    let mut sorted_inputs: Vec<i64> = input_values.to_vec();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let mut sorted_outputs: Vec<i64> = output_values.to_vec();
    sorted_outputs.sort_by(|a, b| b.cmp(a));
    sorted_outputs.retain(|&v| v > 0);

    let n_out = sorted_outputs.len();

    if n_in == 0 || n_out == 0 || crate::analyze::is_single_interpretation(input_values, &sorted_outputs) {
        // analyze() returns a trivial result without enumerating anything
        return Some(crate::analyze::analyze(
            input_values, output_values, fees, max_cj_intrafees_ratio, timeout_ms,
        ));
    }

    // Fallback when single-input matching cannot explain the transaction.
    let fallback = || {
        analyze_participants(
            &sorted_inputs, &sorted_outputs, denomination, fees,
            max_cj_intrafees_ratio, start + timeout_ms as f64, start,
        )
        .or_else(|| {
            crate::analyze::exact_feasible(n_in, n_out).then(|| {
                crate::analyze::analyze(
                    input_values, output_values, fees, max_cj_intrafees_ratio, timeout_ms,
                )
            })
        })
    };

    // Step 1: Match inputs to change outputs
    // Allow up to 5 unmatched changes (multi-input taker)
    let jm = match match_joinmarket(&sorted_inputs, &sorted_outputs, denomination, fees, 5) {
        Some(m) => m,
        None => return fallback(),
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
        return fallback();
    }

    // Step 3: Solve reduced problem
    //
    // Three paths:
    // A) Formula shortcut (n_extra <= 1, all adj >= denom): O(1) via partition formula
    // B) DFS path (n_extra > 1, exact_feasible): exact via subset sum enumeration
    // C) Formula approximation (n_extra > 1, otherwise): approximate using n_cj-party model
    //
    // Path C is needed because DFS Aggregates::new allocates 2^n_in entries
    // and Phase 2 is quadratic in them (see analyze::exact_feasible).
    let min_adj = reduced_inputs.iter().copied().min().unwrap_or(0);
    // Allow 5% tolerance for adjusted inputs below denomination (rounding from fee splits)
    let denom_threshold = denomination - denomination / 20;
    let n_extra = if n_in > n_cj { n_in - n_cj } else { 0 };
    let use_formula = n_extra <= 1
        && min_adj >= denom_threshold
        && n_cj >= 2;

    // DFS feasibility: Aggregates::new needs 1<<n_in entries and Phase 2 is
    // quadratic in that, so large reduced problems use the formula instead.
    let dfs_feasible = crate::analyze::exact_feasible(n_in, n_cj);

    if use_formula {
        // Path A: Formula shortcut for n_extra <= 1
        let formula_n = n_in;
        if formula_n <= 15 {
            // Exact u64 path
            let nb_cmbn = boltzmann_equal_outputs(formula_n);
            let cj_cell = cell_value_equal_outputs(formula_n);
            return Some(build_u64_result(n_in, n_out, &jm, nb_cmbn, cj_cell, fees, start));
        } else {
            // f64 path for large n where u64 overflows
            let nb_cmbn_f64 = boltzmann_equal_outputs_f64(formula_n);
            let cj_prob = cell_probability_equal_outputs(formula_n);
            return Some(build_f64_result(n_in, n_out, &jm, nb_cmbn_f64, cj_prob, fees, start));
        }
    }

    if !dfs_feasible {
        // Path C: Formula approximation for large problems
        // Treat the CJ part as an n_cj-party CoinJoin (each maker + taker collectively)
        let nb_cmbn_f64 = boltzmann_equal_outputs_f64(n_cj);
        let cj_prob = cell_probability_equal_outputs(n_cj);
        return Some(build_f64_result(n_in, n_out, &jm, nb_cmbn_f64, cj_prob, fees, start));
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

    let mut result = finalize_result(
        &full_linker,
        n_in,
        n_out,
        fees,
        actual_fees_maker,
        actual_fees_taker,
        start,
    );
    result.method = "joinmarket";
    Some(result)
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

    let mut result = finalize_result(&full_linker, n_in, n_out, fees, 0, 0, start);
    result.method = "joinmarket";
    result
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
    let scale = comb_scale(nb_cmbn_f64);
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
    let nb_cmbn_saturated = nb_cmbn_f64 >= u64::MAX as f64;
    let nb_cmbn_u64 = if nb_cmbn_saturated { u64::MAX } else { nb_cmbn_f64.round() as u64 };
    let elapsed_ms = (crate::time::now_ms() - start) as u32;

    BoltzmannResult {
        mat_lnk_combinations: mat_comb,
        mat_lnk_probabilities: mat_prob,
        nb_cmbn: nb_cmbn_u64,
        nb_cmbn_saturated,
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
        model_links: Vec::new(),
        method: "joinmarket",
    }
}

/// Denominator of the f64 paths' combinations matrix, so a tooltip's
/// count/total stays meaningful (capped at 10^15).
fn comb_scale(nb_cmbn_f64: f64) -> u64 {
    if nb_cmbn_f64 <= 1e15 {
        nb_cmbn_f64.round().max(1.0) as u64
    } else {
        1_000_000_000_000_000u64
    }
}

/// Largest input set enumerated as one maker's funding (denomination + change).
const MAX_MAKER_INPUTS: usize = 4;
/// Budget of candidate sets plus DP states (memory and time guard).
const MAX_PARTICIPANT_STATES: usize = 2_000_000;
/// Maker fee ratio when the caller passes none (Boltzmann's default
/// maxCjIntrafeesRatio).
const DEFAULT_MAKER_FEE_RATIO: f64 = 0.005;

/// Collect every set of at most MAX_MAKER_INPUTS inputs (as bitmasks) whose
/// sum lies in [lo, hi]. Values are positive, so a set above `hi` is not extended.
#[allow(clippy::too_many_arguments)]
fn collect_funding_sets(values: &[i64], from: usize, depth: usize, mask: u64, sum: i64, lo: i64, hi: i64, out: &mut Vec<u64>) {
    for (i, &v) in values.iter().enumerate().skip(from) {
        let s = sum + v;
        if s > hi {
            continue;
        }
        let m = mask | (1u64 << i);
        if s >= lo {
            out.push(m);
        }
        if depth + 1 < MAX_MAKER_INPUTS {
            collect_funding_sets(values, i + 1, depth + 1, m, s, lo, hi, out);
        }
    }
}

/// JoinMarket participant model, for rounds where makers fund the
/// denomination from several inputs (single-input matching fails).
///
/// Each of the n_cj participants receives one denomination output. Each change
/// output belongs to a distinct maker funded by at most MAX_MAKER_INPUTS inputs,
/// with inputs - denomination - change in [-maker fee, miner fee]. The
/// remaining inputs are the taker's, with residual in [-maker fee, miner fee +
/// taker fees] (fees as in Boltzmann's intrafees convention). When every
/// participant has a change output, each change is tried as the taker's.
///
/// Every grouping of inputs satisfying this is counted exactly (DP over
/// used-input bitmasks), which gives each change row's link probabilities; an
/// input in every grouping of a change is a deterministic link. CJ rows and
/// entropy use the n_cj-party partition formula, as Path C does.
///
/// Returns None when the shape does not fit (more than one participant without
/// change, more changes than CJ outputs, > 64 inputs), no grouping exists, or
/// the state budget/deadline is exceeded.
fn analyze_participants(
    sorted_inputs: &[i64],
    sorted_outputs: &[i64],
    denomination: i64,
    fees: i64,
    max_cj_intrafees_ratio: f64,
    deadline: f64,
    start: f64,
) -> Option<BoltzmannResult> {
    use rustc_hash::FxHashMap;

    let n_in = sorted_inputs.len();
    let n_out = sorted_outputs.len();
    if n_in == 0 || n_in > 64 {
        return None;
    }
    let (cj, changes): (Vec<usize>, Vec<usize>) =
        (0..n_out).partition(|&o| sorted_outputs[o] == denomination);
    let n_cj = cj.len();
    if n_cj < 2 || changes.is_empty() || changes.len() > n_cj || n_cj - changes.len() > 1 {
        return None;
    }

    let ratio = if max_cj_intrafees_ratio > 0.0 { max_cj_intrafees_ratio } else { DEFAULT_MAKER_FEE_RATIO };
    let fees_maker = (denomination as f64 * ratio).round() as i64;
    let taker_max = fees + fees_maker * (n_cj as i64 - 1);
    let full: u64 = if n_in == 64 { u64::MAX } else { (1u64 << n_in) - 1 };
    let mask_sum = |m: u64| -> i64 {
        (0..n_in).filter(|&i| (m >> i) & 1 == 1).map(|i| sorted_inputs[i]).sum()
    };

    let mut budget = 0usize;
    let mut cands: Vec<Vec<u64>> = Vec::with_capacity(changes.len());
    for &o in &changes {
        let target = denomination + sorted_outputs[o];
        let mut sets = Vec::new();
        collect_funding_sets(sorted_inputs, 0, 0, 0, 0, target - fees_maker, target + fees, &mut sets);
        budget += sets.len();
        if budget > MAX_PARTICIPANT_STATES {
            return None;
        }
        cands.push(sets);
    }

    // One run per taker choice: the change-less participant, or each change in turn.
    let takers: Vec<Option<usize>> = if n_cj > changes.len() {
        vec![None]
    } else {
        (0..changes.len()).map(Some).collect()
    };

    // Deadline check per expanded mask (each expands up to all candidate sets);
    // the clock is read every 256 masks.
    let mut ticks = 0u32;
    let mut over_time = || {
        ticks = ticks.wrapping_add(1);
        ticks % 256 == 0 && crate::time::now_ms() > deadline
    };

    let mut total = 0f64;
    let mut marg = vec![vec![0f64; n_in]; changes.len()];
    for taker in takers {
        let mut slots: Vec<usize> = (0..changes.len()).filter(|&j| Some(j) != taker).collect();
        slots.sort_by_key(|&j| cands[j].len()); // most constrained first prunes early
        let taker_change = taker.map_or(0, |j| sorted_outputs[changes[j]]);
        let taker_ok = |used: u64| {
            let rest = full & !used;
            let r = mask_sum(rest) - denomination - taker_change;
            rest != 0 && r >= -fees_maker && r <= taker_max
        };

        // Forward: number of ways to reach each used-input mask after each slot.
        let depth = slots.len();
        let mut reach: Vec<FxHashMap<u64, f64>> = vec![FxHashMap::default(); depth + 1];
        reach[0].insert(0, 1.0);
        for (l, &slot) in slots.iter().enumerate() {
            let (cur, next) = reach.split_at_mut(l + 1);
            for (&mask, &w) in &cur[l] {
                if over_time() || budget + next[0].len() > MAX_PARTICIPANT_STATES {
                    return None;
                }
                for &set in &cands[slot] {
                    if set & mask == 0 {
                        *next[0].entry(mask | set).or_insert(0.0) += w;
                    }
                }
            }
            budget += next[0].len();
        }

        // Backward: number of valid completions from each reachable mask.
        let mut comp: Vec<FxHashMap<u64, f64>> = vec![FxHashMap::default(); depth + 1];
        comp[depth] = reach[depth].keys().map(|&m| (m, if taker_ok(m) { 1.0 } else { 0.0 })).collect();
        for l in (0..depth).rev() {
            let mut level = FxHashMap::default();
            for &mask in reach[l].keys() {
                if over_time() {
                    return None;
                }
                let c: f64 = cands[slots[l]].iter()
                    .filter(|&&set| set & mask == 0)
                    .map(|&set| comp[l + 1].get(&(mask | set)).copied().unwrap_or(0.0))
                    .sum();
                level.insert(mask, c);
            }
            comp[l] = level;
        }
        let run_total = comp[0].get(&0).copied().unwrap_or(0.0);
        if run_total == 0.0 {
            continue;
        }
        total += run_total;

        // Link weights: ways to reach mask, times completions after adding set.
        for (l, &slot) in slots.iter().enumerate() {
            for (&mask, &w) in &reach[l] {
                if over_time() {
                    return None;
                }
                for &set in &cands[slot] {
                    if set & mask != 0 {
                        continue;
                    }
                    let b = comp[l + 1].get(&(mask | set)).copied().unwrap_or(0.0);
                    if b > 0.0 {
                        for i in (0..n_in).filter(|&i| (set >> i) & 1 == 1) {
                            marg[slot][i] += w * b;
                        }
                    }
                }
            }
        }
        if let Some(t) = taker {
            for (&mask, &w) in &reach[depth] {
                if taker_ok(mask) {
                    let rest = full & !mask;
                    for i in (0..n_in).filter(|&i| (rest >> i) & 1 == 1) {
                        marg[t][i] += w;
                    }
                }
            }
        }
    }
    if total == 0.0 {
        return None;
    }

    let nb_cmbn_f64 = boltzmann_equal_outputs_f64(n_cj);
    let jm = JoinMarketMatch {
        input_to_change: vec![None; n_in],
        cj_output_indices: cj,
        unmatched_change_indices: Vec::new(),
    };
    let mut result = build_f64_result(n_in, n_out, &jm, nb_cmbn_f64, cell_probability_equal_outputs(n_cj), fees, start);
    let scale = comb_scale(nb_cmbn_f64) as f64;
    for (j, &o) in changes.iter().enumerate() {
        for i in 0..n_in {
            // An input in every grouping of this change is deterministically linked
            let p = if marg[j][i] >= total { 1.0 } else { marg[j][i] / total };
            result.mat_lnk_probabilities[o][i] = p;
            result.mat_lnk_combinations[o][i] = (p * scale).round() as u64;
            if p == 1.0 {
                result.deterministic_links.push((o, i));
            }
        }
    }
    Some(result)
}
