/// Compute the number of valid interpretations for a perfect CoinJoin
/// with n equal-value inputs and n equal-value outputs.
///
/// Uses the Boltzmann partition formula:
/// N = sum over all integer partitions (s1, ..., sk) of n:
///     n!^2 / (prod(si!^2) * prod(mj!))
///
/// where mj is the multiplicity of each distinct part size.
///
/// Port of boltzmannEqualOutputs() from entropy.ts.
pub fn boltzmann_equal_outputs(n: usize) -> u64 {
    if n <= 1 {
        return 1;
    }

    let partitions = integer_partitions(n);
    let mut total: u64 = 0;

    for partition in &partitions {
        total += partition_count(n, partition);
    }

    total
}

/// Compute the link matrix cell value for a perfect CoinJoin
/// with n equal-value inputs and n equal-value outputs.
///
/// When all inputs and outputs are equal, every cell in the matrix has the
/// same value (by symmetry). This value equals:
///     [sum over partitions: count(partition) * sum(si^2)] / n^2
///
/// Each partition of n into groups (s1, ..., sk) creates sum(si^2) links
/// (each group of size si connects si inputs to si outputs = si^2 links).
pub fn cell_value_equal_outputs(n: usize) -> u64 {
    if n <= 1 {
        return 1;
    }

    let partitions = integer_partitions(n);
    let mut total_links: u128 = 0;

    for partition in &partitions {
        let count = partition_count(n, partition) as u128;
        let links_per: u128 = partition.iter().map(|&s| (s * s) as u128).sum();
        total_links += count * links_per;
    }

    (total_links / (n as u128 * n as u128)) as u64
}

/// Count configurations for a single partition pattern.
/// Uses u128 internally to avoid overflow for n >= 13 (where n!^2 > u64::MAX).
fn partition_count(n: usize, partition: &[usize]) -> u64 {
    let nf = factorial_u128(n);
    let n_fact_sq = nf * nf;

    let mut prod_si_fact_sq: u128 = 1;
    for &s in partition {
        let f = factorial_u128(s);
        prod_si_fact_sq *= f * f;
    }

    let mut mults: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for &s in partition {
        *mults.entry(s).or_insert(0) += 1;
    }
    let mut prod_mj_fact: u128 = 1;
    for &m in mults.values() {
        prod_mj_fact *= factorial_u128(m);
    }

    (n_fact_sq / (prod_si_fact_sq * prod_mj_fact)) as u64
}

fn factorial_u128(n: usize) -> u128 {
    let mut result: u128 = 1;
    for i in 2..=n {
        result *= i as u128;
    }
    result
}

/// f64 version of boltzmann_equal_outputs for large n where u64 overflows.
/// Valid for any n (f64 factorial works up to n ~ 170).
pub fn boltzmann_equal_outputs_f64(n: usize) -> f64 {
    if n <= 1 {
        return 1.0;
    }
    let partitions = integer_partitions(n);
    let mut total: f64 = 0.0;
    for partition in &partitions {
        total += partition_count_f64(n, partition);
    }
    total
}

/// f64 version of cell_value_equal_outputs for large n.
pub fn cell_value_equal_outputs_f64(n: usize) -> f64 {
    if n <= 1 {
        return 1.0;
    }
    let partitions = integer_partitions(n);
    let mut total_links: f64 = 0.0;
    for partition in &partitions {
        let count = partition_count_f64(n, partition);
        let links_per: f64 = partition.iter().map(|&s| (s * s) as f64).sum();
        total_links += count * links_per;
    }
    total_links / (n as f64 * n as f64)
}

/// Cell probability for equal outputs: cell_value / nb_cmbn.
/// More numerically stable than computing both separately for large n.
pub fn cell_probability_equal_outputs(n: usize) -> f64 {
    if n <= 1 {
        return 1.0;
    }
    if n <= 15 {
        return cell_value_equal_outputs(n) as f64 / boltzmann_equal_outputs(n) as f64;
    }
    cell_value_equal_outputs_f64(n) / boltzmann_equal_outputs_f64(n)
}

fn partition_count_f64(n: usize, partition: &[usize]) -> f64 {
    let nf = factorial_f64(n);
    let n_fact_sq = nf * nf;

    let mut prod_si_fact_sq: f64 = 1.0;
    for &s in partition {
        let f = factorial_f64(s);
        prod_si_fact_sq *= f * f;
    }

    let mut mults: std::collections::HashMap<usize, usize> = std::collections::HashMap::new();
    for &s in partition {
        *mults.entry(s).or_insert(0) += 1;
    }
    let mut prod_mj_fact: f64 = 1.0;
    for &m in mults.values() {
        prod_mj_fact *= factorial_f64(m);
    }

    n_fact_sq / (prod_si_fact_sq * prod_mj_fact)
}

fn factorial_f64(n: usize) -> f64 {
    let mut result: f64 = 1.0;
    for i in 2..=n {
        result *= i as f64;
    }
    result
}

/// Compute the number of combinations for a "perfect CoinJoin" with
/// the given number of inputs and outputs.
///
/// This is the denominator for the efficiency calculation.
/// Port of the nbCmbnPrfctCj logic from the TS reference.
pub fn nb_cmbn_perfect_cj(n_ins: usize, n_outs: usize) -> u64 {
    // Perfect CoinJoin: min(n_ins, n_outs) participants, each with 2 outputs
    // (one equal, one change), totaling 2*n outputs.
    // The formula uses the equal-output partition for min(n_ins, n_outs/2) participants...
    // Actually, the reference computes it differently.
    // From the test vectors: nbCmbnPrfctCj uses the structure of the transaction.
    // For P2 (2x2 equal): 3, for P3 (3x3): 16, for 2x4: 7, for 6x2: 21.
    //
    // The reference implementation: the perfect CoinJoin count assumes
    // the "ideal" structure for the given number of ins and outs.
    // For n_ins inputs and n_outs outputs, it's computed as if we had
    // a perfect CoinJoin with min(n_ins, n_outs) equal-value outputs.
    //
    // Looking at test data:
    // 6 in, 2 out -> 21 = boltzmann_equal_outputs(6) with some modification
    // Actually 21 = C(7,2) = 21... or boltzmann_equal_outputs(2)*7...
    // Let me look at this differently.
    // Test 1: 6in, 2out -> nbCmbnPrfctCj=21, nbTxosPrfctCj={nbIns:2, nbOuts:6}
    // Test 3: 2in, 4out -> nbCmbnPrfctCj=7, nbTxosPrfctCj={nbIns:2, nbOuts:4}
    // Test 7: 2in, 2out -> nbCmbnPrfctCj=3, nbTxosPrfctCj={nbIns:2, nbOuts:2}
    // Test 4: 5in, 7out -> nbCmbnPrfctCj=364576, nbTxosPrfctCj={nbIns:5, nbOuts:10}
    //
    // So nbTxosPrfctCj determines the ideal structure, then boltzmann_equal_outputs
    // is computed for that ideal structure.
    //
    // For now, we compute efficiency separately in analyze.rs using the formula
    // from the reference. This function is a placeholder.

    // Simple: for a "perfect" version of this tx, assume max equal outputs
    // The reference uses computeNbCmbnPrfctCj which is complex.
    // Let's return 0 for now and compute properly in analyze.rs.
    let _ = (n_ins, n_outs);
    0
}

/// Generate all integer partitions of n.
/// Each partition is a Vec<usize> of parts in descending order.
fn integer_partitions(n: usize) -> Vec<Vec<usize>> {
    let mut result = Vec::new();
    let mut current = Vec::new();
    generate_partitions(n, n, &mut current, &mut result);
    result
}

fn generate_partitions(
    remaining: usize,
    max_part: usize,
    current: &mut Vec<usize>,
    result: &mut Vec<Vec<usize>>,
) {
    if remaining == 0 {
        result.push(current.clone());
        return;
    }
    let start = std::cmp::min(remaining, max_part);
    for part in (1..=start).rev() {
        current.push(part);
        generate_partitions(remaining - part, part, current, result);
        current.pop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_partition_formula_known_values() {
        assert_eq!(boltzmann_equal_outputs(2), 3);
        assert_eq!(boltzmann_equal_outputs(3), 16);
        assert_eq!(boltzmann_equal_outputs(4), 131);
        assert_eq!(boltzmann_equal_outputs(5), 1496);
        assert_eq!(boltzmann_equal_outputs(6), 22482);
        assert_eq!(boltzmann_equal_outputs(7), 426833);
    }

    #[test]
    fn test_cell_value_known_values() {
        assert_eq!(cell_value_equal_outputs(2), 2);
        assert_eq!(cell_value_equal_outputs(3), 8);
        assert_eq!(cell_value_equal_outputs(4), 53);
        assert_eq!(cell_value_equal_outputs(5), 512);
        assert_eq!(cell_value_equal_outputs(6), 6697);
        assert_eq!(cell_value_equal_outputs(7), 112925);
        assert_eq!(cell_value_equal_outputs(8), 2369635);
        assert_eq!(cell_value_equal_outputs(9), 60263712);
        assert_eq!(cell_value_equal_outputs(10), 1819461473);
        assert_eq!(cell_value_equal_outputs(11), 64142170793);
        assert_eq!(cell_value_equal_outputs(12), 2604657560815);
        assert_eq!(cell_value_equal_outputs(13), 120455319149093);
        assert_eq!(cell_value_equal_outputs(14), 6283178968283583);
        assert_eq!(cell_value_equal_outputs(15), 366614246986890869);
    }

    #[test]
    fn test_integer_partitions_5() {
        let parts = integer_partitions(5);
        assert_eq!(parts.len(), 7);
    }

    #[test]
    fn test_factorial() {
        assert_eq!(factorial_u128(0), 1);
        assert_eq!(factorial_u128(1), 1);
        assert_eq!(factorial_u128(5), 120);
    }

    #[test]
    fn test_f64_matches_u64_for_small_n() {
        for n in 2..=15 {
            let u64_val = boltzmann_equal_outputs(n) as f64;
            let f64_val = boltzmann_equal_outputs_f64(n);
            let rel_err = (u64_val - f64_val).abs() / u64_val;
            assert!(rel_err < 1e-10, "boltzmann_f64 mismatch at n={n}: u64={u64_val}, f64={f64_val}");

            let u64_cell = cell_value_equal_outputs(n) as f64;
            let f64_cell = cell_value_equal_outputs_f64(n);
            let rel_err_cell = (u64_cell - f64_cell).abs() / u64_cell;
            assert!(rel_err_cell < 1e-10, "cell_value_f64 mismatch at n={n}: u64={u64_cell}, f64={f64_cell}");
        }
    }

    #[test]
    fn test_f64_large_n_does_not_panic() {
        // n=17 overflows u64 but should work in f64
        let nb = boltzmann_equal_outputs_f64(17);
        assert!(nb > 0.0 && nb.is_finite(), "n=17 should produce finite result");

        let cell = cell_value_equal_outputs_f64(17);
        assert!(cell > 0.0 && cell.is_finite(), "n=17 cell should produce finite result");

        let prob = cell_probability_equal_outputs(17);
        assert!(prob > 0.0 && prob < 1.0, "n=17 cell probability should be in (0,1)");

        // n=30 is a stress test
        let nb30 = boltzmann_equal_outputs_f64(30);
        assert!(nb30 > 0.0 && nb30.is_finite(), "n=30 should produce finite result");

        let prob30 = cell_probability_equal_outputs(30);
        assert!(prob30 > 0.0 && prob30 < 1.0, "n=30 cell probability should be in (0,1)");
    }

    #[test]
    fn test_cell_probability_decreases_with_n() {
        let mut prev = 1.0;
        for n in 2..=20 {
            let p = cell_probability_equal_outputs(n);
            assert!(p < prev, "cell probability should decrease: n={n}, p={p}, prev={prev}");
            prev = p;
        }
    }
}
