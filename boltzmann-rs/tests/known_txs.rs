use boltzmann_rs::analyze::analyze;

/// Helper to assert a Boltzmann result matches expected values.
fn assert_boltzmann(
    label: &str,
    inputs: &[i64],
    outputs: &[i64],
    fees: i64,
    max_cj_intrafees_ratio: f64,
    expected_nb_cmbn: u64,
    expected_entropy: f64,
    expected_mat_lnk: Option<&[&[u64]]>,
) {
    let result = analyze(inputs, outputs, fees, max_cj_intrafees_ratio, 60_000);

    assert_eq!(
        result.nb_cmbn, expected_nb_cmbn,
        "{label}: nb_cmbn mismatch"
    );

    let entropy_diff = (result.entropy - expected_entropy).abs();
    assert!(
        entropy_diff < 1e-6,
        "{label}: entropy mismatch: got {}, expected {} (diff {entropy_diff})",
        result.entropy,
        expected_entropy
    );

    if let Some(expected_mat) = expected_mat_lnk {
        assert_eq!(
            result.mat_lnk_combinations.len(),
            expected_mat.len(),
            "{label}: matrix row count mismatch"
        );
        for (o, row) in result.mat_lnk_combinations.iter().enumerate() {
            assert_eq!(
                row.len(),
                expected_mat[o].len(),
                "{label}: matrix col count mismatch at row {o}"
            );
            for (i, &val) in row.iter().enumerate() {
                assert_eq!(
                    val, expected_mat[o][i],
                    "{label}: mat_lnk[{o}][{i}] mismatch: got {val}, expected {}",
                    expected_mat[o][i]
                );
            }
        }
    }
}

// ==========================================================================
// Test 1: Consolidation (6-in, 2-out, zero entropy)
// Tx: dcba20fdfe34fe240fa6eacccfb2e58468ba2feafcfff99706145800d09a09a6
// ==========================================================================
#[test]
fn test_consolidation_zero_entropy() {
    assert_boltzmann(
        "Test 1: Consolidation",
        &[5_300_000_000, 2_020_000_000, 4_975_000_000, 5_000_000_000, 5_556_000_000, 7_150_000_000],
        &[1_000_000, 30_000_000_000],
        0,
        0.0,
        1,
        0.0,
        Some(&[
            &[1, 1, 1, 1, 1, 1],
            &[1, 1, 1, 1, 1, 1],
        ]),
    );
}

// ==========================================================================
// Test 2: Simple equal-value swap (2-in, 2-out)
// Tx: 8c5feb901f3983b0f28d996f9606d895d75136dbe8d77ed1d6c7340a403a73bf
// ==========================================================================
#[test]
fn test_equal_value_swap() {
    assert_boltzmann(
        "Test 2: Equal-value swap",
        &[4_900_000_000, 100_000_000],
        &[4_900_000_000, 100_000_000],
        0,
        0.0,
        2,
        1.0,
        Some(&[
            &[2, 1],
            &[1, 2],
        ]),
    );
}

// ==========================================================================
// Test 3: DarkWallet CoinJoin (2-in, 4-out) - THE canonical example
// Tx: 8e56317360a548e8ef28ec475878ef70d1371bee3526c017ac22ad61ae5740b8
// ==========================================================================
#[test]
fn test_darkwallet_coinjoin() {
    assert_boltzmann(
        "Test 3: DarkWallet CoinJoin",
        &[10_000_000, 1_380_000],
        &[100_000, 9_850_000, 100_000, 1_270_000],
        60_000,
        0.0,
        3,
        1.584962500721156,
        Some(&[
            &[3, 1],
            &[1, 3],
            &[2, 2],
            &[2, 2],
        ]),
    );
}

// ==========================================================================
// Test 4a: CoinJoin 4 participants without intrafees (5-in, 7-out)
// Tx: 7d588d52d1cece7a18d663c977d6143016b5b326404bbf286bc024d5d54fcecb
// ==========================================================================
#[test]
fn test_coinjoin_4_participants_no_intrafees() {
    assert_boltzmann(
        "Test 4a: CoinJoin 4p no intrafees",
        &[260_994_463, 98_615_817, 84_911_243, 20_112_774, 79_168_410],
        &[14_868_890, 84_077_613, 84_077_613, 15_369_204, 177_252_160, 84_077_613, 84_077_613],
        2001,
        0.0,
        1,
        0.0,
        Some(&[
            &[1, 1, 1, 1, 1],
            &[1, 1, 1, 1, 1],
            &[1, 1, 1, 1, 1],
            &[1, 1, 1, 1, 1],
            &[1, 1, 1, 1, 1],
            &[1, 1, 1, 1, 1],
            &[1, 1, 1, 1, 1],
        ]),
    );
}

// ==========================================================================
// Test 4b: CoinJoin 4 participants WITH intrafees
// ==========================================================================
#[test]
fn test_coinjoin_4_participants_with_intrafees() {
    assert_boltzmann(
        "Test 4b: CoinJoin 4p with intrafees",
        &[260_994_463, 98_615_817, 84_911_243, 20_112_774, 79_168_410],
        &[14_868_890, 84_077_613, 84_077_613, 15_369_204, 177_252_160, 84_077_613, 84_077_613],
        2001,
        0.005,
        95,
        6.569855608330948,
        Some(&[
            &[95, 9, 25, 11, 11],
            &[35, 38, 46, 33, 33],
            &[35, 38, 46, 33, 33],
            &[35, 38, 46, 33, 33],
            &[35, 38, 46, 33, 33],
            &[9, 27, 43, 73, 73],
            &[11, 73, 21, 27, 27],
        ]),
    );
}

// ==========================================================================
// Test 5: Synthetic equal inputs, mixed outputs (testCaseA)
// ==========================================================================
#[test]
fn test_case_a() {
    assert_boltzmann(
        "Test 5: testCaseA",
        &[10, 10],
        &[8, 2, 3, 7],
        0,
        0.0,
        3,
        1.584962500721156,
        Some(&[
            &[2, 2],
            &[2, 2],
            &[2, 2],
            &[2, 2],
        ]),
    );
}

// ==========================================================================
// Test 6: Symmetric equal inputs/outputs (testCaseB)
// ==========================================================================
#[test]
fn test_case_b() {
    assert_boltzmann(
        "Test 6: testCaseB",
        &[10, 10],
        &[8, 2, 2, 8],
        0,
        0.0,
        5,
        2.321928094887362,
        Some(&[
            &[3, 3],
            &[3, 3],
            &[3, 3],
            &[3, 3],
        ]),
    );
}

// ==========================================================================
// Test 7: Perfect CoinJoin 2x2 (testCaseP2)
// ==========================================================================
#[test]
fn test_perfect_cj_2x2() {
    assert_boltzmann(
        "Test 7: P2",
        &[5, 5],
        &[5, 5],
        0,
        0.0,
        3,
        1.584962500721156,
        Some(&[
            &[2, 2],
            &[2, 2],
        ]),
    );
}

// ==========================================================================
// Test 8: Perfect CoinJoin 3x3 (testCaseP3)
// ==========================================================================
#[test]
fn test_perfect_cj_3x3() {
    assert_boltzmann(
        "Test 8: P3",
        &[5, 5, 5],
        &[5, 5, 5],
        0,
        0.0,
        16,
        4.0,
        Some(&[
            &[8, 8, 8],
            &[8, 8, 8],
            &[8, 8, 8],
        ]),
    );
}

// ==========================================================================
// Test 9: Perfect CoinJoin 4x4 (testCaseP4)
// ==========================================================================
#[test]
fn test_perfect_cj_4x4() {
    assert_boltzmann(
        "Test 9: P4",
        &[5, 5, 5, 5],
        &[5, 5, 5, 5],
        0,
        0.0,
        131,
        7.03342300153745,
        Some(&[
            &[53, 53, 53, 53],
            &[53, 53, 53, 53],
            &[53, 53, 53, 53],
            &[53, 53, 53, 53],
        ]),
    );
}

// ==========================================================================
// Test 10: Perfect CoinJoin 5x5 (testCaseP5 / Whirlpool-like)
// ==========================================================================
#[test]
fn test_perfect_cj_5x5() {
    assert_boltzmann(
        "Test 10: P5",
        &[5, 5, 5, 5, 5],
        &[5, 5, 5, 5, 5],
        0,
        0.0,
        1496,
        10.546894459887637,
        None, // Matrix is large, just check nb_cmbn and entropy
    );
}

// ==========================================================================
// Test 11: Perfect CoinJoin 6x6 (testCaseP6)
// ==========================================================================
#[test]
fn test_perfect_cj_6x6() {
    assert_boltzmann(
        "Test 11: P6",
        &[5, 5, 5, 5, 5, 5],
        &[5, 5, 5, 5, 5, 5],
        0,
        0.0,
        22482,
        14.45648276305027,
        None,
    );
}

// ==========================================================================
// Test 12: Perfect CoinJoin 7x7 (testCaseP7)
// ==========================================================================
#[test]
fn test_perfect_cj_7x7() {
    assert_boltzmann(
        "Test 12: P7",
        &[5, 5, 5, 5, 5, 5, 5],
        &[5, 5, 5, 5, 5, 5, 5],
        0,
        0.0,
        426833,
        18.703312194872563,
        None,
    );
}

// ==========================================================================
// Test 13: 3 inputs mixed (testCaseD)
// ==========================================================================
#[test]
fn test_case_d() {
    assert_boltzmann(
        "Test 13: testCaseD",
        &[10, 10, 2],
        &[8, 2, 2, 8, 2],
        0,
        0.0,
        28,
        4.807354922057604,
        Some(&[
            &[16, 16, 7],
            &[16, 16, 7],
            &[13, 13, 14],
            &[13, 13, 14],
            &[13, 13, 14],
        ]),
    );
}

// ==========================================================================
// Test 14: Complex nondeterministic (9-in, 4-out) with intrafees
// Tx: 015d9cf0a12057d009395710611c65109f36b3eaefa3a694594bf243c097f404
// ==========================================================================
#[test]
fn test_nondeterministic_9in_4out() {
    assert_boltzmann(
        "Test 14: Nondeterministic 9-in 4-out",
        &[203486, 5_000_000, 11126, 9829, 9_572_867, 13796, 150000, 82835, 5_000_000],
        &[791116, 907419, 9_136_520, 9_136_520],
        72364,
        0.005,
        438,
        8.774787059601174,
        Some(&[
            &[245, 245, 245, 245, 245, 131, 114, 113, 113],
            &[245, 245, 245, 245, 245, 131, 114, 113, 113],
            &[126, 364, 364, 126, 136, 163, 109, 111, 111],
            &[364, 126, 126, 364, 354, 99, 119, 115, 115],
        ]),
    );
}

// ==========================================================================
// Test 15: "Hell is other people" from LaurentMT Part 3
// ==========================================================================
#[test]
fn test_hell_is_other_people() {
    // i1=1 BTC, i2=2 BTC -> o1=0.8, o2=0.2, o3=0.8, o4=1.2 BTC
    // Same structure as DarkWallet example: should have 3 interpretations
    assert_boltzmann(
        "Test 15: Hell is other people",
        &[100_000_000, 200_000_000],
        &[80_000_000, 20_000_000, 80_000_000, 120_000_000],
        0,
        0.0,
        3,
        1.584962500721156,
        None, // Verify nb_cmbn and entropy match DarkWallet structure
    );
}

// ==========================================================================
// Test 16: Trivial 1-in, 2-out
// ==========================================================================
#[test]
fn test_trivial_1in_2out() {
    let result = analyze(
        &[200_000],
        &[100_000, 90_000],
        10_000,
        0.0,
        60_000,
    );

    assert_eq!(result.nb_cmbn, 1, "Trivial: nb_cmbn should be 1");
    assert_eq!(result.entropy, 0.0, "Trivial: entropy should be 0");
    // All links deterministic
    assert_eq!(result.deterministic_links.len(), 2, "Trivial: should have 2 deterministic links");
}

// ==========================================================================
// Test: testCaseB2 (2-in, 3-out)
// ==========================================================================
#[test]
fn test_case_b2() {
    assert_boltzmann(
        "testCaseB2",
        &[10, 10],
        &[10, 2, 8],
        0,
        0.0,
        3,
        1.584962500721156,
        None,
    );
}

// ==========================================================================
// Test: testCaseC (2-in, 4-out equal)
// ==========================================================================
#[test]
fn test_case_c() {
    assert_boltzmann(
        "testCaseC",
        &[10, 10],
        &[5, 5, 5, 5],
        0,
        0.0,
        7,
        2.807354922057604,
        None,
    );
}

// ==========================================================================
// Test: testCaseC2 (2-in, 3-out)
// ==========================================================================
#[test]
fn test_case_c2() {
    assert_boltzmann(
        "testCaseC2",
        &[10, 10],
        &[10, 5, 5],
        0,
        0.0,
        3,
        1.584962500721156,
        None,
    );
}

// ==========================================================================
// Test: P3 with fees (3-in, 3-out with fee=5)
// ==========================================================================
#[test]
fn test_perfect_cj_3x3_with_fees() {
    assert_boltzmann(
        "P3WithFees",
        &[5, 5, 5],
        &[5, 3, 2],
        5,
        0.0,
        28,
        4.807354922057604,
        None,
    );
}

// ==========================================================================
// Test: P3b (3-in, 3-out non-equal)
// ==========================================================================
#[test]
fn test_perfect_cj_3x3_b() {
    assert_boltzmann(
        "P3b",
        &[5, 5, 10],
        &[5, 5, 10],
        0,
        0.0,
        9,
        3.169925001442312,
        None,
    );
}

// ==========================================================================
// Test: Partition formula (unit test for boltzmann_equal_outputs)
// ==========================================================================
#[test]
fn test_partition_formula() {
    use boltzmann_rs::partition::boltzmann_equal_outputs;
    assert_eq!(boltzmann_equal_outputs(2), 3);
    assert_eq!(boltzmann_equal_outputs(3), 16);
    assert_eq!(boltzmann_equal_outputs(4), 131);
    assert_eq!(boltzmann_equal_outputs(5), 1496);
    assert_eq!(boltzmann_equal_outputs(6), 22482);
    assert_eq!(boltzmann_equal_outputs(7), 426833);
}
