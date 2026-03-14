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
}
