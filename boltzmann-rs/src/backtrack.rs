use rustc_hash::FxHashMap as HashMap;

use crate::subset_sum::{AggregateMatches, Aggregates};
use crate::types::LinkerResult;

/// Sparse map for d_out inner entries: stores (key, [nb_parents, nb_children]) pairs.
/// Optimized for small number of entries (typically 1-10) with linear scan.
type DOutInner = Vec<(usize, [u64; 2])>;

/// d_out: Vec indexed by output_remaining mask. Each entry is None or a small
/// vec of (left_output_mask, [nb_parents, nb_children]) pairs.
type DOut = Vec<Option<DOutInner>>;

/// Create an empty d_out with capacity for all output masks.
#[inline(always)]
fn new_d_out(out_size: usize) -> DOut {
    vec![None; out_size]
}

/// Look up an entry in d_out inner by key.
#[inline(always)]
fn d_out_inner_get(inner: &DOutInner, key: usize) -> Option<&[u64; 2]> {
    for &(k, ref v) in inner {
        if k == key {
            return Some(v);
        }
    }
    None
}

/// d_links: Vec indexed by input mask, each entry is a Vec indexed by output mask.
/// Lazily initialized per input mask.
type DLinks = Vec<Option<Vec<u64>>>;

/// Create an empty d_links with capacity for all input masks.
#[inline(always)]
fn new_d_links(in_size: usize) -> DLinks {
    vec![None; in_size]
}

/// A task on the DFS stack.
/// Mirrors ComputeLinkMatrixTask from the TS reference.
struct Task {
    /// Index into decomposition list for the current ir.
    idx_il: usize,
    /// Left input sub-aggregate (already assigned, smaller child).
    il: usize,
    /// Right input sub-aggregate (to be decomposed further, bigger child).
    ir: usize,
    /// Output combination state:
    /// d_out[output_remaining][left_output] = [nb_parents, nb_children]
    d_out: DOut,
    /// Indices in d_out that have non-None entries (for efficient iteration).
    active: Vec<usize>,
}

/// Resumable DFS state for the chunked API.
///
/// Holds all mutable state needed to run the DFS in time-limited chunks,
/// yielding between chunks so the worker can post progress.
pub struct DfsState {
    matches: AggregateMatches,
    mat_in_agg_cmbn: Vec<Vec<(usize, usize)>>,
    stack: Vec<Task>,
    d_links: DLinks,
    nb_tx_cmbn: u64,
    timed_out: bool,
    it_gt: usize,
    ot_gt: usize,
    out_size: usize,
    /// Number of completed top-level (root) branches.
    pub completed_root_branches: u32,
    /// Total number of root branches in this run.
    pub total_root_branches: u32,
    /// Exclusive upper bound for root-level iteration (for ranged DFS).
    branch_end: usize,
}

/// Convert a HashMap<usize, Vec<(usize, usize)>> to a Vec indexed by key.
fn hashmap_to_vec(map: HashMap<usize, Vec<(usize, usize)>>, size: usize) -> Vec<Vec<(usize, usize)>> {
    let mut v = vec![Vec::new(); size];
    for (k, val) in map {
        if k < size {
            v[k] = val;
        }
    }
    v
}

impl DfsState {
    /// Create a new DFS state ready for stepping.
    ///
    /// Phases 1+2 must already be complete. This initializes the DFS stack
    /// with the root task.
    pub fn new(
        in_agg: &Aggregates,
        out_agg: &Aggregates,
        matches: AggregateMatches,
        mat_in_agg_cmbn: HashMap<usize, Vec<(usize, usize)>>,
    ) -> Self {
        let it_gt = in_agg.full_mask();
        let total = mat_in_agg_cmbn
            .get(&it_gt)
            .map_or(0, |v| v.len());
        Self::new_ranged(in_agg, out_agg, matches, mat_in_agg_cmbn, 0, total)
    }

    /// Create a DFS state restricted to a range of root-level branches.
    ///
    /// Used for multi-worker parallelism: each worker gets a disjoint
    /// `[branch_start .. branch_start + branch_count)` slice of the
    /// root decomposition list (`mat_in_agg_cmbn[it_gt]`).
    pub fn new_ranged(
        in_agg: &Aggregates,
        out_agg: &Aggregates,
        matches: AggregateMatches,
        mat_in_agg_cmbn: HashMap<usize, Vec<(usize, usize)>>,
        branch_start: usize,
        branch_count: usize,
    ) -> Self {
        let it_gt = in_agg.full_mask();
        let ot_gt = out_agg.full_mask();
        let out_size = ot_gt + 1;
        let in_size = it_gt + 1;

        // Initialize root task d_out: {otGt: {0: [1, 0]}}
        let mut root_d_out = new_d_out(out_size);
        root_d_out[ot_gt] = Some(vec![(0usize, [1u64, 0u64])]);

        let root_task = Task {
            idx_il: branch_start,
            il: 0,
            ir: it_gt,
            d_out: root_d_out,
            active: vec![ot_gt],
        };

        let mat_vec = hashmap_to_vec(mat_in_agg_cmbn, in_size);

        Self {
            matches,
            mat_in_agg_cmbn: mat_vec,
            stack: vec![root_task],
            d_links: new_d_links(in_size),
            nb_tx_cmbn: 0,
            timed_out: false,
            it_gt,
            ot_gt,
            out_size,
            completed_root_branches: 0,
            total_root_branches: branch_count as u32,
            branch_end: branch_start + branch_count,
        }
    }

    /// Run the DFS loop until `chunk_deadline` or `overall_deadline` is hit,
    /// or the DFS completes.
    ///
    /// Returns `true` when the DFS is fully done (stack empty or timed out).
    pub fn step(&mut self, chunk_deadline: f64, overall_deadline: f64) -> bool {
        while !self.stack.is_empty() {
            // Check both deadlines
            let now = crate::time::now_ms();
            if now >= overall_deadline {
                self.timed_out = true;
                return true;
            }
            if now >= chunk_deadline {
                return false; // yield - not done yet
            }

            let stack_len = self.stack.len();
            let t = &mut self.stack[stack_len - 1];
            let mut n_idx_il = t.idx_il;

            let ircs = &self.mat_in_agg_cmbn[t.ir];
            let len_ircs = ircs.len();

            // Cap root-level iteration at branch_end for ranged DFS
            let effective_len = if stack_len == 1 {
                len_ircs.min(self.branch_end)
            } else {
                len_ircs
            };

            let mut pushed = false;

            for i in t.idx_il..effective_len {
                n_idx_il = i;
                let n_il = ircs[i].1; // smaller child
                let n_ir = ircs[i].0; // bigger child

                if n_il > t.il {
                    let (nd_out, nd_active) = run_task(
                        n_il,
                        n_ir,
                        &self.matches,
                        self.ot_gt,
                        self.out_size,
                        &t.d_out,
                        &t.active,
                    );

                    t.idx_il = i + 1;

                    self.stack.push(Task {
                        idx_il: 0,
                        il: n_il,
                        ir: n_ir,
                        d_out: nd_out,
                        active: nd_active,
                    });

                    pushed = true;
                    break;
                } else {
                    n_idx_il = effective_len;
                    break;
                }
            }

            if !pushed && n_idx_il >= effective_len {
                let t = self.stack.pop().unwrap();
                if self.stack.is_empty() {
                    // Root task completed: extract nb_tx_cmbn
                    if let Some(ref root_d) = t.d_out[self.ot_gt] {
                        if let Some(entry) = d_out_inner_get(root_d, 0) {
                            self.nb_tx_cmbn = entry[1];
                        }
                    }
                } else {
                    on_task_completed(
                        &t,
                        self.stack.last_mut().unwrap(),
                        &mut self.d_links,
                        self.out_size,
                    );
                    // Track root branch completion: if only root remains after pop
                    if self.stack.len() == 1 {
                        self.completed_root_branches += 1;
                    }
                }
            }
        }

        true // stack empty - DFS complete
    }

    /// Finalize the link matrix after DFS is complete.
    ///
    /// Consumes the DFS state and returns the LinkerResult.
    pub fn finalize(self, in_agg: &Aggregates, out_agg: &Aggregates) -> LinkerResult {
        finalize_link_matrix(
            in_agg,
            out_agg,
            self.it_gt,
            self.ot_gt,
            &self.d_links,
            self.nb_tx_cmbn,
            self.timed_out,
        )
    }

    /// Whether the DFS timed out.
    pub fn timed_out(&self) -> bool {
        self.timed_out
    }
}

/// Phase 3+4: Enumerate all valid complete mappings using stack-based DFS,
/// then finalize the link probability matrix.
///
/// Faithfully mirrors TxosAggregator.computeLinkMatrix() from the TS reference.
pub fn compute_link_matrix(
    in_agg: &Aggregates,
    out_agg: &Aggregates,
    matches: &AggregateMatches,
    mat_in_agg_cmbn: &HashMap<usize, Vec<(usize, usize)>>,
    deadline_ms: Option<f64>,
) -> LinkerResult {
    let it_gt = in_agg.full_mask();
    let ot_gt = out_agg.full_mask();
    let out_size = ot_gt + 1;
    let in_size = it_gt + 1;

    let mut nb_tx_cmbn: u64 = 0;

    // Initialize dLinks accumulator
    let mut d_links: DLinks = new_d_links(in_size);

    // Build a Vec of slices for direct indexing from the HashMap
    let empty_vec: Vec<(usize, usize)> = Vec::new();
    let mat_vec: Vec<&[(usize, usize)]> = {
        let mut v: Vec<&[(usize, usize)]> = vec![&empty_vec; in_size];
        for (k, val) in mat_in_agg_cmbn {
            if *k < in_size {
                v[*k] = val.as_slice();
            }
        }
        v
    };

    // Initialize root task d_out: {otGt: {0: [1, 0]}}
    let mut root_d_out = new_d_out(out_size);
    root_d_out[ot_gt] = Some(vec![(0usize, [1u64, 0u64])]);

    let root_task = Task {
        idx_il: 0,
        il: 0,
        ir: it_gt,
        d_out: root_d_out,
        active: vec![ot_gt],
    };

    let mut stack: Vec<Task> = vec![root_task];

    let mut timed_out = false;

    while !stack.is_empty() {
        // Timeout check
        if let Some(deadline) = deadline_ms {
            let now = crate::time::now_ms();
            if now >= deadline {
                timed_out = true;
                break;
            }
        }

        let stack_len = stack.len();
        let t = &mut stack[stack_len - 1];
        let mut n_idx_il = t.idx_il;

        let ircs = mat_vec[t.ir];
        let len_ircs = ircs.len();

        let mut pushed = false;

        for i in t.idx_il..len_ircs {
            n_idx_il = i;
            let n_il = ircs[i].1; // smaller child
            let n_ir = ircs[i].0; // bigger child

            if n_il > t.il {
                // Valid decomposition found
                let (nd_out, nd_active) = run_task(
                    n_il,
                    n_ir,
                    matches,
                    ot_gt,
                    out_size,
                    &t.d_out,
                    &t.active,
                );

                t.idx_il = i + 1;

                stack.push(Task {
                    idx_il: 0,
                    il: n_il,
                    ir: n_ir,
                    d_out: nd_out,
                    active: nd_active,
                });

                pushed = true;
                break;
            } else {
                // n_il <= t.il: skip rest
                n_idx_il = len_ircs;
                break;
            }
        }

        if !pushed && n_idx_il >= len_ircs {
            // All decompositions exhausted or none found - pop task
            let t = stack.pop().unwrap();
            if stack.is_empty() {
                // Root task completed: extract nb_tx_cmbn from d_out
                if let Some(ref root_d) = t.d_out[ot_gt] {
                    if let Some(entry) = d_out_inner_get(root_d, 0) {
                        nb_tx_cmbn = entry[1]; // [1] = nb_children
                    }
                }
            } else {
                // Non-root: back-propagate to parent
                on_task_completed(&t, stack.last_mut().unwrap(), &mut d_links, out_size);
            }
        }
    }

    // Phase 4: Finalize link matrix
    finalize_link_matrix(
        in_agg, out_agg, it_gt, ot_gt, &d_links, nb_tx_cmbn, timed_out,
    )
}

/// Find compatible output splits for a given input decomposition.
///
/// Mirrors TxosAggregator.runTask() from the TS reference.
/// Returns (d_out, active_indices).
fn run_task(
    n_il: usize,
    n_ir: usize,
    matches: &AggregateMatches,
    ot_gt: usize,
    out_size: usize,
    parent_d_out: &DOut,
    parent_active: &[usize],
) -> (DOut, Vec<usize>) {
    let mut nd_out = new_d_out(out_size);
    let mut nd_active = Vec::new();

    // Hoist lookups via pre-resolved indices (no HashMap lookups)
    let il_idx = match matches.mask_to_out_list_idx[n_il] {
        Some(idx) => idx,
        None => return (nd_out, nd_active),
    };
    let ir_idx = match matches.mask_to_out_list_idx[n_ir] {
        Some(idx) => idx,
        None => return (nd_out, nd_active),
    };
    let out_aggs_il = &matches.out_agg_lists[il_idx];
    let out_aggs_ir_set = &matches.out_agg_sets[ir_idx];

    // Iterate only active (non-None) entries in parent d_out
    for &o_r in parent_active {
        let ol_map = parent_d_out[o_r].as_ref().unwrap();
        let sol = ot_gt - o_r; // already-assigned output bits
        let nb_prt: u64 = ol_map.iter().map(|&(_, v)| v[0]).sum();

        for &n_ol in out_aggs_il {
            // n_ol must not overlap with already-assigned outputs
            if (sol & n_ol) != 0 {
                continue;
            }

            let n_sol = sol + n_ol;
            let n_or = ot_gt - n_sol; // remaining outputs for right input

            if (n_sol & n_or) == 0 && out_aggs_ir_set[n_or] {
                if nd_out[n_or].is_none() {
                    nd_out[n_or] = Some(Vec::new());
                    nd_active.push(n_or);
                }
                nd_out[n_or].as_mut().unwrap().push((n_ol, [nb_prt, 0]));
            }
        }
    }

    (nd_out, nd_active)
}

/// Back-propagate results when a child task completes.
///
/// Mirrors TxosAggregator.onTaskCompleted() from the TS reference.
fn on_task_completed(
    t: &Task,
    pt: &mut Task,
    d_links: &mut DLinks,
    out_size: usize,
) {
    let il = t.il;
    let ir = t.ir;

    // Pre-ensure d_links entries exist for ir and il to avoid repeated checks
    if d_links[ir].is_none() {
        d_links[ir] = Some(vec![0u64; out_size]);
    }
    if d_links[il].is_none() {
        d_links[il] = Some(vec![0u64; out_size]);
    }

    // Iterate only active entries
    for &o_r in &t.active {
        let l_ol = t.d_out[o_r].as_ref().unwrap();
        for &(ol, entry) in l_ol {
            let nb_prnt = entry[0];
            let nb_chld = entry[1];
            let nb_occur = nb_chld + 1;

            // Add dLink: [ir, or] += nb_prnt
            d_links[ir].as_mut().unwrap()[o_r] += nb_prnt;

            // Add dLink: [il, ol] += nb_prnt * nb_occur
            d_links[il].as_mut().unwrap()[ol] += nb_prnt * nb_occur;

            // Update parent's d_out: at p_or = ol + or, increment all child counts
            let p_or = ol + o_r;
            if let Some(ref mut p_ol_vec) = pt.d_out[p_or] {
                for (_p_ol, p_entry) in p_ol_vec.iter_mut() {
                    p_entry[1] += nb_occur; // increment nb_children
                }
            }
        }
    }
}

/// Phase 4: Assemble the final link count matrix from dLinks.
///
/// Mirrors TxosAggregator.finalizeLinkMatrix() from the TS reference.
fn finalize_link_matrix(
    in_agg: &Aggregates,
    out_agg: &Aggregates,
    it_gt: usize,
    ot_gt: usize,
    d_links: &DLinks,
    mut nb_tx_cmbn: u64,
    timed_out: bool,
) -> LinkerResult {
    let n_in = in_agg.n;
    let n_out = out_agg.n;

    // Start with base matrix: all inputs linked to all outputs (one interpretation)
    let mut links = vec![vec![0u64; n_in]; n_out];
    update_link_cmbn(&mut links, it_gt, ot_gt, in_agg, out_agg);
    nb_tx_cmbn += 1;

    // Add contributions from dLinks (directly, without temporary matrix)
    for (key0, slot) in d_links.iter().enumerate() {
        let sub_vec = match slot {
            Some(ref v) => v,
            None => continue,
        };
        let in_indexes = &in_agg.all_agg_indexes[key0];
        for (key1, &mult) in sub_vec.iter().enumerate() {
            if mult == 0 {
                continue;
            }
            let out_indexes = &out_agg.all_agg_indexes[key1];
            for &out_idx in out_indexes {
                for &in_idx in in_indexes {
                    links[out_idx][in_idx] += mult;
                }
            }
        }
    }

    LinkerResult {
        mat_lnk: links,
        nb_cmbn: nb_tx_cmbn,
        timed_out,
    }
}

/// Update link matrix: for each (input_index, output_index) pair in the
/// given aggregate masks, set the cell to +1.
///
/// Mirrors TxosAggregator.updateLinkCmbn() from the TS reference.
fn update_link_cmbn(
    mat: &mut [Vec<u64>],
    in_agg_mask: usize,
    out_agg_mask: usize,
    in_agg: &Aggregates,
    out_agg: &Aggregates,
) {
    let in_indexes = &in_agg.all_agg_indexes[in_agg_mask];
    let out_indexes = &out_agg.all_agg_indexes[out_agg_mask];

    for &in_idx in in_indexes {
        for &out_idx in out_indexes {
            mat[out_idx][in_idx] += 1;
        }
    }
}
