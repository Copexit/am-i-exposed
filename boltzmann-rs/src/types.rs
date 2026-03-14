use serde::Serialize;

/// Metadata returned by `prepare_boltzmann` for the chunked DFS API.
#[derive(Debug, Clone, Serialize)]
pub struct PrepareResult {
    /// Number of top-level DFS root branches for the current run.
    pub total_root_branches: u32,
    /// Whether a second DFS run (with intrafees) will be attempted.
    pub has_dual_run: bool,
}

/// Metadata returned by `prepare_boltzmann_ranged` for the multi-worker API.
#[derive(Debug, Clone, Serialize)]
pub struct PrepareRangedResult {
    /// Number of root branches assigned to this worker.
    pub assigned_branches: u32,
    /// Total root branches across all workers.
    pub total_root_branches: u32,
}

/// Progress returned by each `dfs_step` call.
#[derive(Debug, Clone, Serialize)]
pub struct StepResult {
    /// True when all DFS runs are complete.
    pub done: bool,
    /// Root branches completed in the current run.
    pub completed_branches: u32,
    /// Total root branches in the current run.
    pub total_branches: u32,
    /// Which run is active: 0 = no intrafees, 1 = with intrafees.
    pub run_index: u8,
    /// Whether the overall deadline was hit.
    pub timed_out: bool,
}

/// Result of a Boltzmann analysis on a transaction.
#[derive(Debug, Clone, Serialize)]
pub struct BoltzmannResult {
    /// Raw link count matrix [nOut][nIn]. matLnkCombinations[o][i] = number of
    /// valid interpretations containing a link between output o and input i.
    pub mat_lnk_combinations: Vec<Vec<u64>>,
    /// Probability matrix [nOut][nIn]. matLnkProbabilities[o][i] = count / nbCmbn.
    pub mat_lnk_probabilities: Vec<Vec<f64>>,
    /// Total number of valid interpretations (complete mappings).
    pub nb_cmbn: u64,
    /// Entropy in bits: log2(nb_cmbn). 0 when nb_cmbn <= 1.
    pub entropy: f64,
    /// Wallet efficiency: nb_cmbn / nb_cmbn_prfct_cj. 0 when nb_cmbn_prfct_cj is 0.
    pub efficiency: f64,
    /// Number of combinations for a perfect CoinJoin with the same structure.
    pub nb_cmbn_prfct_cj: u64,
    /// Deterministic links: (output_idx, input_idx) pairs where P = 1.0.
    pub deterministic_links: Vec<(usize, usize)>,
    /// Whether the computation timed out (partial results).
    pub timed_out: bool,
    /// Wall-clock elapsed time in milliseconds.
    pub elapsed_ms: u32,
    pub n_inputs: usize,
    pub n_outputs: usize,
    pub fees: i64,
    pub intra_fees_maker: i64,
    pub intra_fees_taker: i64,
}

/// Intermediate result from the linker: raw link counts + combination count.
#[derive(Debug, Clone)]
pub struct LinkerResult {
    /// Raw link count matrix [nOut][nIn].
    pub mat_lnk: Vec<Vec<u64>>,
    /// Total number of valid complete mappings.
    pub nb_cmbn: u64,
    /// Whether computation timed out.
    pub timed_out: bool,
}

impl LinkerResult {
    pub fn new_zero(n_outputs: usize, n_inputs: usize) -> Self {
        Self {
            mat_lnk: vec![vec![0u64; n_inputs]; n_outputs],
            nb_cmbn: 0,
            timed_out: false,
        }
    }

    /// Create a degenerate result where every input is linked to every output
    /// (single interpretation = all links are deterministic).
    pub fn new_degenerate(n_outputs: usize, n_inputs: usize) -> Self {
        Self {
            mat_lnk: vec![vec![1u64; n_inputs]; n_outputs],
            nb_cmbn: 1,
            timed_out: false,
        }
    }
}
