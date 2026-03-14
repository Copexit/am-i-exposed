use rustc_hash::FxHashMap as HashMap;

use crate::subset_sum::{AggregateMatches, Aggregates};
use crate::types::LinkerResult;

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
    d_out: HashMap<usize, HashMap<usize, [u64; 2]>>,
}

/// Resumable DFS state for the chunked API.
///
/// Holds all mutable state needed to run the DFS in time-limited chunks,
/// yielding between chunks so the worker can post progress.
pub struct DfsState {
    matches: AggregateMatches,
    mat_in_agg_cmbn: HashMap<usize, Vec<(usize, usize)>>,
    stack: Vec<Task>,
    d_links: HashMap<usize, HashMap<usize, u64>>,
    nb_tx_cmbn: u64,
    timed_out: bool,
    it_gt: usize,
    ot_gt: usize,
    /// Number of completed top-level (root) branches.
    pub completed_root_branches: u32,
    /// Total number of root branches in this run.
    pub total_root_branches: u32,
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
        let ot_gt = out_agg.full_mask();

        let total_root_branches = mat_in_agg_cmbn
            .get(&it_gt)
            .map_or(0, |v| v.len() as u32);

        // Initialize root task d_out: {otGt: {0: [1, 0]}}
        let mut root_d_out: HashMap<usize, HashMap<usize, [u64; 2]>> = HashMap::default();
        let mut inner = HashMap::default();
        inner.insert(0usize, [1u64, 0u64]);
        root_d_out.insert(ot_gt, inner);

        let root_task = Task {
            idx_il: 0,
            il: 0,
            ir: it_gt,
            d_out: root_d_out,
        };

        Self {
            matches,
            mat_in_agg_cmbn,
            stack: vec![root_task],
            d_links: HashMap::default(),
            nb_tx_cmbn: 0,
            timed_out: false,
            it_gt,
            ot_gt,
            completed_root_branches: 0,
            total_root_branches,
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

            let ircs = self.mat_in_agg_cmbn.get(&t.ir);
            let len_ircs = ircs.map_or(0, |v| v.len());

            let mut pushed = false;

            for i in t.idx_il..len_ircs {
                n_idx_il = i;
                let ircs_vec = ircs.unwrap();
                let n_il = ircs_vec[i].1; // smaller child
                let n_ir = ircs_vec[i].0; // bigger child

                if n_il > t.il {
                    let nd_out = run_task(
                        n_il,
                        n_ir,
                        &self.matches,
                        self.ot_gt,
                        &t.d_out,
                    );

                    t.idx_il = i + 1;

                    self.stack.push(Task {
                        idx_il: 0,
                        il: n_il,
                        ir: n_ir,
                        d_out: nd_out,
                    });

                    pushed = true;
                    break;
                } else {
                    n_idx_il = len_ircs;
                    break;
                }
            }

            if !pushed && n_idx_il >= len_ircs {
                let t = self.stack.pop().unwrap();
                if self.stack.is_empty() {
                    // Root task completed: extract nb_tx_cmbn
                    if let Some(root_d) = t.d_out.get(&self.ot_gt) {
                        if let Some(entry) = root_d.get(&0) {
                            self.nb_tx_cmbn = entry[1];
                        }
                    }
                } else {
                    on_task_completed(&t, self.stack.last_mut().unwrap(), &mut self.d_links);
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

    let mut nb_tx_cmbn: u64 = 0;

    // Initialize dLinks accumulator: key0 -> (key1 -> multiplier)
    let mut d_links: HashMap<usize, HashMap<usize, u64>> = HashMap::default();

    // Initialize root task d_out: {otGt: {0: [1, 0]}}
    let mut root_d_out: HashMap<usize, HashMap<usize, [u64; 2]>> = HashMap::default();
    let mut inner = HashMap::default();
    inner.insert(0usize, [1u64, 0u64]);
    root_d_out.insert(ot_gt, inner);

    let root_task = Task {
        idx_il: 0,
        il: 0,
        ir: it_gt,
        d_out: root_d_out,
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

        let ircs = mat_in_agg_cmbn.get(&t.ir);
        let len_ircs = ircs.map_or(0, |v| v.len());

        let mut pushed = false;

        for i in t.idx_il..len_ircs {
            n_idx_il = i;
            let ircs_vec = ircs.unwrap();
            // In the reference: ircs[i] = [bigger, smaller] = (i_val, j_val)
            // nIl = ircs[i][1] = smaller child (j)
            // nIr = ircs[i][0] = bigger child (i)
            let n_il = ircs_vec[i].1; // smaller child
            let n_ir = ircs_vec[i].0; // bigger child

            if n_il > t.il {
                // Valid decomposition found
                let nd_out = run_task(
                    n_il,
                    n_ir,
                    matches,
                    ot_gt,
                    &t.d_out,
                );

                t.idx_il = i + 1;

                stack.push(Task {
                    idx_il: 0,
                    il: n_il,
                    ir: n_ir,
                    d_out: nd_out,
                });

                pushed = true;
                break;
            } else {
                // n_il <= t.il: skip rest (the reference sets nIdxIl = ircs.length and breaks)
                n_idx_il = len_ircs;
                break;
            }
        }

        if !pushed && n_idx_il >= len_ircs {
            // All decompositions exhausted or none found - pop task
            let t = stack.pop().unwrap();
            if stack.is_empty() {
                // Root task completed: extract nb_tx_cmbn from d_out
                if let Some(root_d) = t.d_out.get(&ot_gt) {
                    if let Some(entry) = root_d.get(&0) {
                        nb_tx_cmbn = entry[1]; // [1] = nb_children
                    }
                }
            } else {
                // Non-root: back-propagate to parent
                on_task_completed(&t, stack.last_mut().unwrap(), &mut d_links);
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
fn run_task(
    n_il: usize,
    n_ir: usize,
    matches: &AggregateMatches,
    ot_gt: usize,
    parent_d_out: &HashMap<usize, HashMap<usize, [u64; 2]>>,
) -> HashMap<usize, HashMap<usize, [u64; 2]>> {
    let mut nd_out: HashMap<usize, HashMap<usize, [u64; 2]>> = HashMap::default();

    // Hoist lookups that are constant across all o_r iterations
    let val_il = match matches.match_in_agg_to_val.get(&n_il) {
        Some(&v) => v,
        None => return nd_out,
    };
    let out_aggs_il = match matches.val_to_match_out_agg.get(&val_il) {
        Some(v) => v,
        None => return nd_out,
    };
    let val_ir = match matches.match_in_agg_to_val.get(&n_ir) {
        Some(&v) => v,
        None => return nd_out,
    };
    let out_aggs_ir_set = match matches.val_to_match_out_agg_set.get(&val_ir) {
        Some(v) => v,
        None => return nd_out,
    };

    for (&o_r, ol_map) in parent_d_out {
        let sol = ot_gt - o_r; // already-assigned output bits
        let nb_prt: u64 = ol_map.values().map(|v| v[0]).sum();

        for &n_ol in out_aggs_il {
            // n_ol must not overlap with already-assigned outputs
            if (sol & n_ol) != 0 {
                continue;
            }

            let n_sol = sol + n_ol;
            let n_or = ot_gt - n_sol; // remaining outputs for right input

            if (n_sol & n_or) == 0 && out_aggs_ir_set.contains(&n_or) {
                nd_out
                    .entry(n_or)
                    .or_default()
                    .insert(n_ol, [nb_prt, 0]);
            }
        }
    }

    nd_out
}

/// Back-propagate results when a child task completes.
///
/// Mirrors TxosAggregator.onTaskCompleted() from the TS reference.
fn on_task_completed(
    t: &Task,
    pt: &mut Task,
    d_links: &mut HashMap<usize, HashMap<usize, u64>>,
) {
    let il = t.il;
    let ir = t.ir;

    for (&o_r, l_ol) in &t.d_out {
        for (&ol, entry) in l_ol {
            let nb_prnt = entry[0];
            let nb_chld = entry[1];
            let nb_occur = nb_chld + 1;

            // Add dLink: [ir, or] += nb_prnt
            *d_links.entry(ir).or_default().entry(o_r).or_insert(0) += nb_prnt;

            // Add dLink: [il, ol] += nb_prnt * nb_occur
            *d_links.entry(il).or_default().entry(ol).or_insert(0) += nb_prnt * nb_occur;

            // Update parent's d_out: at p_or = ol + or, increment all child counts
            let p_or = ol + o_r;
            if let Some(p_ol_map) = pt.d_out.get_mut(&p_or) {
                for (_p_ol, p_entry) in p_ol_map.iter_mut() {
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
    d_links: &HashMap<usize, HashMap<usize, u64>>,
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
    for (&key0, sub_map) in d_links {
        let in_indexes = &in_agg.all_agg_indexes[key0];
        for (&key1, &mult) in sub_map {
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
