use rustc_hash::{FxHashMap as HashMap, FxHashSet};

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
    /// For each matched input aggregate mask, the value it maps to (its sum).
    pub match_in_agg_to_val: HashMap<usize, i64>,
    /// For each value, the list of matching output aggregate masks.
    pub val_to_match_out_agg: HashMap<i64, Vec<usize>>,
    /// Same as val_to_match_out_agg but as FxHashSets for O(1) contains().
    pub val_to_match_out_agg_set: HashMap<i64, FxHashSet<usize>>,
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

    // Collect unique input aggregate values (sorted, including index 0 = empty set)
    let mut unique_in_vals: Vec<i64> = in_agg.all_agg_val.to_vec();
    unique_in_vals.sort();
    unique_in_vals.dedup();

    // Collect unique output aggregate values (sorted, including index 0 = empty set)
    let mut unique_out_vals: Vec<i64> = out_agg.all_agg_val.to_vec();
    unique_out_vals.sort();
    unique_out_vals.dedup();

    let mut all_match_in_agg: Vec<usize> = Vec::new();
    let mut all_match_in_agg_seen: FxHashSet<usize> = FxHashSet::default();
    let mut match_in_agg_to_val: HashMap<usize, i64> = HashMap::default();
    let mut val_to_match_out_agg: HashMap<i64, Vec<usize>> = HashMap::default();
    let mut out_mask_seen: HashMap<i64, FxHashSet<usize>> = HashMap::default();

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
                    if val == in_agg_val && all_match_in_agg_seen.insert(in_idx) {
                        all_match_in_agg.push(in_idx);
                        match_in_agg_to_val.insert(in_idx, in_agg_val);
                    }
                }

                // Register matching output masks under the input value key
                let out_masks = val_to_match_out_agg
                    .entry(in_agg_val)
                    .or_default();
                let seen = out_mask_seen.entry(in_agg_val).or_default();
                for (out_idx, &val) in out_agg.all_agg_val.iter().enumerate() {
                    if val == out_agg_val && seen.insert(out_idx) {
                        out_masks.push(out_idx);
                    }
                }
            }
        }
    }

    // Build HashSet version for O(1) lookups in run_task
    let val_to_match_out_agg_set: HashMap<i64, FxHashSet<usize>> = val_to_match_out_agg
        .iter()
        .map(|(&k, v)| (k, v.iter().copied().collect()))
        .collect();

    AggregateMatches {
        all_match_in_agg,
        match_in_agg_to_val,
        val_to_match_out_agg,
        val_to_match_out_agg_set,
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

    let agg_set: FxHashSet<usize> = aggs.iter().copied().collect();

    for i in 0..=tgt {
        if !agg_set.contains(&i) {
            continue;
        }
        let j_max = std::cmp::min(i, tgt - i + 1);
        for j in 0..j_max {
            if (i & j) == 0 && agg_set.contains(&j) {
                mat.entry(i + j).or_default().push((i, j));
            }
        }
    }

    mat
}
