use rustc_hash::FxHashMap as HashMap;

/// Precomputed aggregates: for each bitmask (subset of indexes), its value sum
/// and the list of individual indexes in that subset.
pub struct Aggregates {
    /// allAggVal[mask] = sum of values at positions indicated by set bits.
    pub all_agg_val: Vec<i64>,
    /// allAggIndexes[mask] = vec of individual indexes with set bits.
    pub all_agg_indexes: Vec<Vec<usize>>,
    /// Number of elements (inputs or outputs).
    pub n: usize,
}

impl Aggregates {
    pub fn new(values: &[i64]) -> Self {
        let n = values.len();
        let size = 1usize << n;
        let mut all_agg_val = vec![0i64; size];
        let mut all_agg_indexes: Vec<Vec<usize>> = Vec::with_capacity(size);

        for mask in 0..size {
            let mut indexes = Vec::new();
            let mut sum = 0i64;
            for bit in 0..n {
                if (mask >> bit) & 1 == 1 {
                    indexes.push(bit);
                    sum += values[bit];
                }
            }
            all_agg_val[mask] = sum;
            all_agg_indexes.push(indexes);
        }

        Self {
            all_agg_val,
            all_agg_indexes,
            n,
        }
    }

    pub fn full_mask(&self) -> usize {
        (1usize << self.n) - 1
    }
}

/// Result of matching input and output aggregates by value.
pub struct AggregateMatches {
    /// All matched input aggregate masks (sorted, includes 0 as first element).
    pub all_match_in_agg: Vec<usize>,
    /// For each input bitmask, the index into the shared out_agg_lists / out_agg_sets
    /// arrays. None if this input mask is not matched.
    /// This replaces match_in_agg_to_val + val_to_match_out_agg + val_to_match_out_agg_set
    /// with direct O(1) indexing.
    pub mask_to_out_list_idx: Vec<Option<usize>>,
    /// Shared output aggregate lists (one per unique matched input value).
    pub out_agg_lists: Vec<Vec<usize>>,
    /// Shared output aggregate sets (bitmask-indexed bool vecs) for O(1) contains().
    pub out_agg_sets: Vec<Vec<bool>>,
}

/// Phase 1: Match input and output aggregates by value, accounting for fees.
///
/// Mirrors TxosAggregator.matchAggByVal() from the TS reference.
pub fn match_agg_by_val(
    in_agg: &Aggregates,
    out_agg: &Aggregates,
    fees: i64,
    fees_maker: i64,
    fees_taker: i64,
) -> AggregateMatches {
    let has_intrafees = fees_maker > 0 || fees_taker > 0;
    let effective_fees_taker = if has_intrafees { fees + fees_taker } else { 0 };
    let effective_fees_maker = if has_intrafees { -fees_maker } else { 0 };

    let in_size = in_agg.all_agg_val.len();
    let out_size = out_agg.all_agg_val.len();

    // Collect unique input aggregate values (sorted, including index 0 = empty set)
    let mut unique_in_vals: Vec<i64> = in_agg.all_agg_val.to_vec();
    unique_in_vals.sort();
    unique_in_vals.dedup();

    // Collect unique output aggregate values (sorted, including index 0 = empty set)
    let mut unique_out_vals: Vec<i64> = out_agg.all_agg_val.to_vec();
    unique_out_vals.sort();
    unique_out_vals.dedup();

    let mut all_match_in_agg: Vec<usize> = Vec::new();
    let mut all_match_in_agg_seen: Vec<bool> = vec![false; in_size];
    // Map input value -> index into out_agg_lists/out_agg_sets
    let mut val_to_list_idx: HashMap<i64, usize> = HashMap::default();
    let mut out_agg_lists: Vec<Vec<usize>> = Vec::new();
    // Temporary: per-value seen set for deduplication
    let mut out_mask_seen: Vec<Vec<bool>> = Vec::new();
    // Per input mask: which list index it maps to
    let mut mask_to_val: Vec<Option<i64>> = vec![None; in_size];

    for &in_agg_val in &unique_in_vals {
        for &out_agg_val in &unique_out_vals {
            let diff = in_agg_val - out_agg_val;

            let cond_no_intrafees = !has_intrafees && diff >= 0 && diff <= fees;
            let cond_intrafees = has_intrafees
                && ((diff <= 0 && diff >= effective_fees_maker)
                    || (diff >= 0 && diff <= effective_fees_taker));

            if !has_intrafees && diff < 0 {
                break; // output vals are sorted ascending, so no more matches
            }

            if cond_no_intrafees || cond_intrafees {
                // Register all input masks with this sum value
                for (in_idx, &val) in in_agg.all_agg_val.iter().enumerate() {
                    if val == in_agg_val && !all_match_in_agg_seen[in_idx] {
                        all_match_in_agg_seen[in_idx] = true;
                        all_match_in_agg.push(in_idx);
                        mask_to_val[in_idx] = Some(in_agg_val);
                    }
                }

                // Ensure we have a list for this value
                let list_idx = *val_to_list_idx.entry(in_agg_val).or_insert_with(|| {
                    let idx = out_agg_lists.len();
                    out_agg_lists.push(Vec::new());
                    out_mask_seen.push(vec![false; out_size]);
                    idx
                });

                // Register matching output masks
                let out_masks = &mut out_agg_lists[list_idx];
                let seen = &mut out_mask_seen[list_idx];
                for (out_idx, &val) in out_agg.all_agg_val.iter().enumerate() {
                    if val == out_agg_val && !seen[out_idx] {
                        seen[out_idx] = true;
                        out_masks.push(out_idx);
                    }
                }
            }
        }
    }

    // Build out_agg_sets (bitmask-indexed bool vecs) from out_agg_lists
    let out_agg_sets: Vec<Vec<bool>> = out_agg_lists
        .iter()
        .map(|list| {
            let mut bools = vec![false; out_size];
            for &mask in list {
                bools[mask] = true;
            }
            bools
        })
        .collect();

    // Build mask_to_out_list_idx: for each input mask, resolve value -> list index
    let mask_to_out_list_idx: Vec<Option<usize>> = mask_to_val
        .iter()
        .map(|opt_val| opt_val.and_then(|v| val_to_list_idx.get(&v).copied()))
        .collect();

    AggregateMatches {
        all_match_in_agg,
        mask_to_out_list_idx,
        out_agg_lists,
        out_agg_sets,
    }
}

/// Phase 2: Build the input decomposition tree.
///
/// Mirrors TxosAggregator.computeInAggCmbn() from the TS reference.
///
/// For each pair of matched input aggregates (i, j) where:
/// - i & j == 0 (non-overlapping bitmasks)
/// - i > j (prevent symmetric duplicates)
/// Store as mat[i+j].push([i, j])
///
/// Note: [i, j] in the reference means [bigger, smaller] = [i, j] where i > j.
pub fn compute_in_agg_cmbn(
    matches: &AggregateMatches,
) -> HashMap<usize, Vec<(usize, usize)>> {
    let mut aggs = matches.all_match_in_agg.clone();

    // Remove first element unconditionally (mirrors reference's aggs.shift())
    if !aggs.is_empty() {
        aggs.remove(0);
    }

    let mut mat: HashMap<usize, Vec<(usize, usize)>> = HashMap::default();

    if aggs.is_empty() {
        return mat;
    }

    let tgt = *aggs.last().unwrap();
    aggs.pop(); // Remove the last (largest) element

    let mut agg_set_vec: Vec<bool> = vec![false; tgt + 1];
    for &a in &aggs {
        if a <= tgt {
            agg_set_vec[a] = true;
        }
    }

    for i in 0..=tgt {
        if !agg_set_vec[i] {
            continue;
        }
        let j_max = std::cmp::min(i, tgt - i + 1);
        for j in 0..j_max {
            if (i & j) == 0 && agg_set_vec[j] {
                mat.entry(i + j).or_default().push((i, j));
            }
        }
    }

    mat
}
