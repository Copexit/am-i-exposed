use rustc_hash::FxHashMap as HashMap;

use crate::backtrack::compute_link_matrix;
use crate::subset_sum::{compute_in_agg_cmbn, match_agg_by_val, AggregateMatches, Aggregates};
use crate::types::{BoltzmannResult, LinkerResult};

/// Top-level orchestration: compute the Boltzmann analysis for a transaction.
///
/// Mirrors the flow: TxProcessor.processTx() -> TxosLinker.process() ->
/// TxosAggregator.matchAggByVal/computeInAggCmbn/computeLinkMatrix
pub fn analyze(
    input_values: &[i64],
    output_values: &[i64],
    fees: i64,
    max_cj_intrafees_ratio: f64,
    timeout_ms: u32,
) -> BoltzmannResult {
    let start = crate::time::now_ms();
    let deadline = start + timeout_ms as f64;
    let n_in = input_values.len();
    let n_out = output_values.len();

    // Early exit: trivial transactions
    if n_in <= 1 || n_out == 0 {
        return make_degenerate_result(input_values, output_values, fees, start);
    }

    // Sort inputs and outputs by value descending (matching the reference)
    let mut sorted_inputs: Vec<i64> = input_values.to_vec();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let mut sorted_outputs: Vec<i64> = output_values.to_vec();
    sorted_outputs.sort_by(|a, b| b.cmp(a));

    // Filter out zero-value outputs (OP_RETURN)
    sorted_outputs.retain(|&v| v > 0);
    let n_out = sorted_outputs.len();

    if n_out == 0 {
        return make_degenerate_result(input_values, output_values, fees, start);
    }

    // Compute intrafees if ratio > 0
    let (fees_maker, fees_taker) = if max_cj_intrafees_ratio > 0.0 {
        compute_intrafees(&sorted_outputs, max_cj_intrafees_ratio)
    } else {
        (0, 0)
    };

    // Run without intrafees first
    let result_no_intra = run_linker(
        &sorted_inputs, &sorted_outputs, fees, 0, 0, Some(deadline),
    );

    // If intrafees are available and we got a result, try with intrafees
    let (final_result, actual_fees_maker, actual_fees_taker) =
        if fees_maker > 0 && !result_no_intra.timed_out {
            let result_with_intra = run_linker(
                &sorted_inputs, &sorted_outputs, fees,
                fees_maker, fees_taker, Some(deadline),
            );

            // Take the result with more combinations
            if result_with_intra.nb_cmbn > result_no_intra.nb_cmbn {
                (result_with_intra, fees_maker, fees_taker)
            } else {
                (result_no_intra, 0, 0)
            }
        } else {
            (result_no_intra, 0, 0)
        };

    // Compute perfect CoinJoin combination count for efficiency
    let nb_cmbn_prfct_cj = compute_nb_cmbn_prfct_cj(n_out, n_in);

    // Compute efficiency
    let efficiency = if nb_cmbn_prfct_cj > 0 && final_result.nb_cmbn > 0 {
        final_result.nb_cmbn as f64 / nb_cmbn_prfct_cj as f64
    } else {
        0.0
    };

    // Compute entropy
    let entropy = if final_result.nb_cmbn > 1 {
        (final_result.nb_cmbn as f64).log2()
    } else {
        0.0
    };

    // Compute probabilities
    let mat_lnk_probabilities = if final_result.nb_cmbn > 0 {
        final_result
            .mat_lnk
            .iter()
            .map(|row| {
                row.iter()
                    .map(|&count| count as f64 / final_result.nb_cmbn as f64)
                    .collect()
            })
            .collect()
    } else {
        vec![vec![0.0; n_in]; n_out]
    };

    // Find deterministic links
    let mut deterministic_links = Vec::new();
    for (o, row) in final_result.mat_lnk.iter().enumerate() {
        for (i, &count) in row.iter().enumerate() {
            if count == final_result.nb_cmbn && final_result.nb_cmbn > 0 {
                deterministic_links.push((o, i));
            }
        }
    }

    let elapsed_ms = (crate::time::now_ms() - start) as u32;

    BoltzmannResult {
        mat_lnk_combinations: final_result.mat_lnk,
        mat_lnk_probabilities,
        nb_cmbn: final_result.nb_cmbn,
        entropy,
        efficiency,
        nb_cmbn_prfct_cj,
        deterministic_links,
        timed_out: final_result.timed_out,
        elapsed_ms,
        n_inputs: n_in,
        n_outputs: n_out,
        fees,
        intra_fees_maker: actual_fees_maker,
        intra_fees_taker: actual_fees_taker,
    }
}

/// Run the full linker pipeline (phases 1-4).
fn run_linker(
    inputs: &[i64],
    outputs: &[i64],
    fees: i64,
    fees_maker: i64,
    fees_taker: i64,
    deadline_ms: Option<f64>,
) -> LinkerResult {
    let in_agg = Aggregates::new(inputs);
    let out_agg = Aggregates::new(outputs);

    // Phase 1: Match aggregates by value
    let matches = match_agg_by_val(&in_agg, &out_agg, fees, fees_maker, fees_taker);

    // Phase 2: Build input decomposition tree
    let mat_in_agg_cmbn = compute_in_agg_cmbn(&matches);

    let it_gt = in_agg.full_mask();

    // If no decompositions exist for the full input set, there's one interpretation
    if !mat_in_agg_cmbn.contains_key(&it_gt) {
        return LinkerResult::new_degenerate(outputs.len(), inputs.len());
    }

    // Phases 3+4: DFS enumeration + matrix finalization
    compute_link_matrix(&in_agg, &out_agg, &matches, &mat_in_agg_cmbn, deadline_ms)
}

/// Detect CoinJoin pattern and compute intrafees.
///
/// Mirrors TxProcessor.checkCoinjoinPattern() + computeCoinjoinIntrafees().
fn compute_intrafees(outputs: &[i64], max_ratio: f64) -> (i64, i64) {
    // Find the most common output value with count >= 2
    let mut value_counts: HashMap<i64, usize> = HashMap::default();
    for &v in outputs {
        *value_counts.entry(v).or_insert(0) += 1;
    }

    let mut best_amount: i64 = 0;
    let mut best_count: usize = 0;
    for (&val, &count) in &value_counts {
        if count >= 2 && (count > best_count || (count == best_count && val > best_amount)) {
            best_amount = val;
            best_count = count;
        }
    }

    if best_count < 2 {
        return (0, 0);
    }

    // Check CoinJoin pattern: nb_outputs <= 2 * nb_participants
    let nb_participants = best_count;
    if outputs.len() > 2 * nb_participants {
        return (0, 0);
    }

    // Compute intrafees
    let fees_maker = (best_amount as f64 * max_ratio).round() as i64;
    let fees_taker = fees_maker * (nb_participants as i64 - 1);

    (fees_maker, fees_taker)
}

/// Compute the perfect CoinJoin combination count for efficiency calculation.
///
/// Mirrors getClosestPerfectCoinjoin() + computeCmbnsPerfectCj() from the
/// reference implementation (tx-processor.ts).
fn compute_nb_cmbn_prfct_cj(n_outs: usize, n_ins: usize) -> u64 {
    let (ni, no) = get_closest_perfect_coinjoin(n_ins, n_outs);
    lookup_nb_cmbn_prfct_cj(ni, no)
}

/// Find the closest perfect CoinJoin structure for given input/output counts.
///
/// Mirrors TxProcessor.getClosestPerfectCoinjoin() from the TS reference.
fn get_closest_perfect_coinjoin(nb_ins: usize, nb_outs: usize) -> (usize, usize) {
    let (ni, no) = if nb_ins > nb_outs {
        (nb_outs, nb_ins)
    } else {
        (nb_ins, nb_outs)
    };

    if ni == 0 {
        return (0, 0);
    }

    if no % ni == 0 {
        return (ni, no);
    }

    let tgt_ratio = 1 + no / ni;
    (ni, ni * tgt_ratio)
}

/// Precomputed table of perfect CoinJoin combination counts.
/// Values that exceed u64 are omitted (efficiency = 0.0 in those cases).
///
/// Sourced from Dojo-Open-Source-Project/boltzmann tx-processor-const.ts.
fn lookup_nb_cmbn_prfct_cj(n_ins: usize, n_outs: usize) -> u64 {
    match (n_ins, n_outs) {
        (2, 2) => 3,
        (2, 4) => 7,
        (2, 6) => 21,
        (2, 8) => 71,
        (2, 10) => 253,
        (2, 12) => 925,
        (2, 14) => 3433,
        (2, 16) => 12871,
        (2, 18) => 48621,
        (2, 20) => 184757,
        (2, 22) => 705433,
        (2, 24) => 2704157,
        (2, 26) => 10400601,
        (2, 28) => 40116601,
        (2, 30) => 155117521,
        (2, 32) => 601080391,
        (2, 34) => 2333606221,
        (2, 36) => 9075135301,
        (2, 38) => 35345263801,
        (2, 40) => 137846528821,
        (2, 42) => 538257874441,
        (2, 44) => 2104098963721,
        (2, 46) => 8233430727601,
        (2, 48) => 32247603683101,
        (2, 50) => 126410606437753,
        (2, 52) => 495918532948105,
        (2, 54) => 1946939425648113,
        (2, 56) => 7648690600760441,
        (2, 58) => 30067266499541041,
        (3, 3) => 16,
        (3, 6) => 136,
        (3, 9) => 1933,
        (3, 12) => 36136,
        (3, 15) => 765766,
        (3, 18) => 17208829,
        (3, 21) => 399421801,
        (3, 24) => 9467718184,
        (3, 27) => 227887491976,
        (3, 30) => 5551086926386,
        (3, 33) => 136527576073201,
        (3, 36) => 3384735517554301,
        (3, 39) => 84478122440142733,
        (3, 42) => 2120572824491415241,
        (4, 4) => 131,
        (4, 8) => 5363,
        (4, 12) => 484133,
        (4, 16) => 68514291,
        (4, 20) => 12012712381,
        (4, 24) => 2323743984773,
        (4, 28) => 473344553671561,
        (4, 32) => 99607509723421171,
        (5, 5) => 1496,
        (5, 10) => 364576,
        (5, 15) => 259611626,
        (5, 20) => 350213630176,
        (5, 25) => 648252792073371,
        (5, 30) => 1385735353073096026,
        (6, 6) => 22482,
        (6, 12) => 38627062,
        (6, 18) => 257724038997,
        (6, 24) => 3974299100880182,
        (7, 7) => 426833,
        (7, 14) => 5954556245,
        (7, 21) => 429444262130885,
        (8, 8) => 9934563,
        (8, 16) => 1270419685859,
        (8, 24) => 1119189777360104613,
        (9, 9) => 277006192,
        (9, 18) => 361129730330368,
        (10, 10) => 9085194458,
        (10, 20) => 132737352875454782,
        (11, 11) => 345322038293,
        (12, 12) => 15024619744202,
        (13, 13) => 740552967629021,
        (14, 14) => 40984758230303149,
        (15, 15) => 2527342803112928081,
        _ => 0, // Exceeds u64 or not in table
    }
}

/// Intermediate state after sorting and intrafees computation,
/// ready for the chunked DFS API.
pub struct PreparedAnalysis {
    pub sorted_inputs: Vec<i64>,
    pub sorted_outputs: Vec<i64>,
    pub fees: i64,
    pub fees_maker: i64,
    pub fees_taker: i64,
    pub in_agg: Aggregates,
    pub out_agg: Aggregates,
    pub n_in: usize,
    pub n_out: usize,
}

/// Prepare a transaction for chunked Boltzmann analysis.
///
/// Sorts values, computes intrafees, and creates Aggregates.
/// Returns `None` for degenerate transactions (<=1 input or 0 outputs).
pub fn prepare_analysis(
    input_values: &[i64],
    output_values: &[i64],
    fees: i64,
    max_cj_intrafees_ratio: f64,
) -> Option<PreparedAnalysis> {
    let n_in = input_values.len();
    if n_in <= 1 {
        return None;
    }

    let mut sorted_inputs: Vec<i64> = input_values.to_vec();
    sorted_inputs.sort_by(|a, b| b.cmp(a));

    let mut sorted_outputs: Vec<i64> = output_values.to_vec();
    sorted_outputs.sort_by(|a, b| b.cmp(a));
    sorted_outputs.retain(|&v| v > 0);

    let n_out = sorted_outputs.len();
    if n_out == 0 {
        return None;
    }

    let (fees_maker, fees_taker) = if max_cj_intrafees_ratio > 0.0 {
        compute_intrafees(&sorted_outputs, max_cj_intrafees_ratio)
    } else {
        (0, 0)
    };

    let in_agg = Aggregates::new(&sorted_inputs);
    let out_agg = Aggregates::new(&sorted_outputs);

    Some(PreparedAnalysis {
        sorted_inputs,
        sorted_outputs,
        fees,
        fees_maker,
        fees_taker,
        in_agg,
        out_agg,
        n_in,
        n_out,
    })
}

/// Run Phase 1+2 for a prepared analysis with the given fee parameters.
///
/// Returns the AggregateMatches and input decomposition tree, or None
/// if no decompositions exist for the full input set (degenerate case).
pub fn run_phases_1_2(
    in_agg: &Aggregates,
    out_agg: &Aggregates,
    fees: i64,
    fees_maker: i64,
    fees_taker: i64,
) -> Option<(AggregateMatches, HashMap<usize, Vec<(usize, usize)>>)> {
    let matches = match_agg_by_val(in_agg, out_agg, fees, fees_maker, fees_taker);
    let mat_in_agg_cmbn = compute_in_agg_cmbn(&matches);

    let it_gt = in_agg.full_mask();
    if !mat_in_agg_cmbn.contains_key(&it_gt) {
        return None;
    }

    Some((matches, mat_in_agg_cmbn))
}

/// Finalize a Boltzmann result from a LinkerResult.
///
/// Computes probabilities, entropy, efficiency, and deterministic links.
/// Used by both the monolithic `analyze()` and the chunked API's `dfs_finalize()`.
pub fn finalize_result(
    result: &LinkerResult,
    n_in: usize,
    n_out: usize,
    fees: i64,
    fees_maker: i64,
    fees_taker: i64,
    start: f64,
) -> BoltzmannResult {
    let nb_cmbn_prfct_cj = compute_nb_cmbn_prfct_cj(n_out, n_in);

    let efficiency = if nb_cmbn_prfct_cj > 0 && result.nb_cmbn > 0 {
        result.nb_cmbn as f64 / nb_cmbn_prfct_cj as f64
    } else {
        0.0
    };

    let entropy = if result.nb_cmbn > 1 {
        (result.nb_cmbn as f64).log2()
    } else {
        0.0
    };

    let mat_lnk_probabilities = if result.nb_cmbn > 0 {
        result
            .mat_lnk
            .iter()
            .map(|row| {
                row.iter()
                    .map(|&count| count as f64 / result.nb_cmbn as f64)
                    .collect()
            })
            .collect()
    } else {
        vec![vec![0.0; n_in]; n_out]
    };

    let mut deterministic_links = Vec::new();
    for (o, row) in result.mat_lnk.iter().enumerate() {
        for (i, &count) in row.iter().enumerate() {
            if count == result.nb_cmbn && result.nb_cmbn > 0 {
                deterministic_links.push((o, i));
            }
        }
    }

    let elapsed_ms = (crate::time::now_ms() - start) as u32;

    BoltzmannResult {
        mat_lnk_combinations: result.mat_lnk.clone(),
        mat_lnk_probabilities,
        nb_cmbn: result.nb_cmbn,
        entropy,
        efficiency,
        nb_cmbn_prfct_cj,
        deterministic_links,
        timed_out: result.timed_out,
        elapsed_ms,
        n_inputs: n_in,
        n_outputs: n_out,
        fees,
        intra_fees_maker: fees_maker,
        intra_fees_taker: fees_taker,
    }
}

/// Create a degenerate result for trivial transactions.
fn make_degenerate_result(
    inputs: &[i64],
    outputs: &[i64],
    fees: i64,
    start: f64,
) -> BoltzmannResult {
    let n_in = inputs.len();
    let n_out = outputs.len();

    let mat = vec![vec![1u64; n_in]; n_out];
    let probs = vec![vec![1.0; n_in]; n_out];
    let mut dlinks = Vec::new();
    for o in 0..n_out {
        for i in 0..n_in {
            dlinks.push((o, i));
        }
    }

    let elapsed_ms = (crate::time::now_ms() - start) as u32;

    BoltzmannResult {
        mat_lnk_combinations: mat,
        mat_lnk_probabilities: probs,
        nb_cmbn: 1,
        entropy: 0.0,
        efficiency: 0.0,
        nb_cmbn_prfct_cj: 0,
        deterministic_links: dlinks,
        timed_out: false,
        elapsed_ms,
        n_inputs: n_in,
        n_outputs: n_out,
        fees,
        intra_fees_maker: 0,
        intra_fees_taker: 0,
    }
}
