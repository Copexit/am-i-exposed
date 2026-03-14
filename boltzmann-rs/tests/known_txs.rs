use boltzmann_rs::analyze::analyze;
use boltzmann_rs::joinmarket::analyze_joinmarket;

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

// ==========================================================================
// JoinMarket Turbo Mode Tests
// ==========================================================================

// Synthetic 3-party JM: 2 makers + 1 taker
// Maker 1: input 150 -> CJ 100 + change 49 (maker fee 1)
// Maker 2: input 120 -> CJ 100 + change 19 (maker fee 1)
// Taker:   input 106 -> CJ 100 (pays miner fee 8 - maker fees 2 = net 6)
#[test]
fn test_jm_turbo_3party() {
    let inputs = [150i64, 120, 106];
    let outputs = [100i64, 100, 100, 49, 19];
    let fee = 8i64;

    let turbo = analyze_joinmarket(&inputs, &outputs, fee, 100, 0.0, 60_000);

    assert!(!turbo.timed_out, "JM turbo 3p: should not timeout");
    assert!(turbo.nb_cmbn > 0, "JM turbo 3p: should have valid combinations");
    assert_eq!(turbo.n_inputs, 3);
    assert_eq!(turbo.n_outputs, 5);

    // Change outputs should have deterministic links
    // Sorted outputs desc: [100, 100, 100, 49, 19]
    // Change 49 at out idx 3 -> matched to input 150 at in idx 0
    // Change 19 at out idx 4 -> matched to input 120 at in idx 1
    assert!(
        turbo.deterministic_links.contains(&(3, 0)),
        "JM turbo 3p: change 49 should link to input 150"
    );
    assert!(
        turbo.deterministic_links.contains(&(4, 1)),
        "JM turbo 3p: change 19 should link to input 120"
    );
}

// Wrong denomination triggers fallback to standard Boltzmann
#[test]
fn test_jm_turbo_fallback_wrong_denom() {
    let inputs = [150i64, 120, 106];
    let outputs = [100i64, 100, 100, 49, 19];
    let fee = 8i64;

    let standard = analyze(&inputs, &outputs, fee, 0.0, 60_000);
    let turbo = analyze_joinmarket(&inputs, &outputs, fee, 50, 0.0, 60_000);

    assert_eq!(
        turbo.nb_cmbn, standard.nb_cmbn,
        "JM turbo fallback: nb_cmbn should match standard"
    );
    let entropy_diff = (turbo.entropy - standard.entropy).abs();
    assert!(
        entropy_diff < 1e-10,
        "JM turbo fallback: entropy should match standard"
    );
}

// Synthetic 5-party JM: 4 makers + 1 taker
// Maker fees ~1000 sats each, miner fee covers the rest
#[test]
fn test_jm_turbo_5party() {
    let inputs = [1_600_000i64, 1_300_000, 1_100_000, 1_050_000, 1_006_000];
    let outputs = [
        1_000_000i64, 1_000_000, 1_000_000, 1_000_000, 1_000_000,
        599_000, 299_000, 99_000, 49_000,
    ];
    let fee = 10_000i64;

    let turbo = analyze_joinmarket(&inputs, &outputs, fee, 1_000_000, 0.0, 60_000);

    assert!(!turbo.timed_out, "JM turbo 5p: should not timeout");
    assert!(turbo.nb_cmbn > 0, "JM turbo 5p: should have combinations");
    assert_eq!(turbo.n_inputs, 5);
    assert_eq!(turbo.n_outputs, 9);

    // Sorted outputs desc: [1M x5, 599k, 299k, 99k, 49k]
    // Change 599k (idx 5) -> input 1.6M (idx 0)
    // Change 299k (idx 6) -> input 1.3M (idx 1)
    // Change 99k  (idx 7) -> input 1.1M (idx 2)
    // Change 49k  (idx 8) -> input 1.05M (idx 3)
    assert!(turbo.deterministic_links.contains(&(5, 0)), "JM turbo 5p: change 599k -> input 1.6M");
    assert!(turbo.deterministic_links.contains(&(6, 1)), "JM turbo 5p: change 299k -> input 1.3M");
    assert!(turbo.deterministic_links.contains(&(7, 2)), "JM turbo 5p: change 99k -> input 1.1M");
    assert!(turbo.deterministic_links.contains(&(8, 3)), "JM turbo 5p: change 49k -> input 1.05M");
}

// 10-party JM: formula shortcut (would timeout without it)
#[test]
fn test_jm_turbo_10party_formula() {
    // 9 makers + 1 taker = 10 participants, 10 CJ outputs
    let inputs = [
        10_000_000i64, 7_500_000, 5_000_000, 4_000_000, 3_000_000,
        2_500_000, 2_000_000, 1_500_000, 1_200_000, 1_015_000,
    ];
    let outputs = [
        1_000_000i64, 1_000_000, 1_000_000, 1_000_000, 1_000_000,
        1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000,
        8_999_000, 6_499_000, 3_999_000, 2_999_000, 1_999_000,
        1_499_000, 999_000, 499_000, 199_000,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let turbo = analyze_joinmarket(&inputs, &outputs, fee, 1_000_000, 0.0, 5_000);

    assert!(!turbo.timed_out, "JM turbo 10p: should not timeout with formula shortcut");
    assert_eq!(turbo.nb_cmbn, 9_085_194_458, "JM turbo 10p: nb_cmbn should match partition formula");
    assert_eq!(turbo.n_inputs, 10);
    assert_eq!(turbo.n_outputs, 19);
    assert!(turbo.elapsed_ms < 100, "JM turbo 10p: should complete in <100ms, got {}ms", turbo.elapsed_ms);

    // Sorted outputs desc: [8.999M, 6.499M, 3.999M, 2.999M, 1.999M, 1.499M, 1M×10, 999K, 499K, 199K]
    // Changes at sorted indices 0-5 and 16-18, CJ at 6-15
    // Change 8.999M (idx 0) -> input 10M (idx 0): residual 9M - 8.999M = 1K
    // Change 6.499M (idx 1) -> input 7.5M (idx 1): residual 6.5M - 6.499M = 1K
    // Change 3.999M (idx 2) -> input 5M (idx 2): residual 4M - 3.999M = 1K
    // Change 2.999M (idx 3) -> input 4M (idx 3): residual 3M - 2.999M = 1K
    // Change 1.999M (idx 4) -> input 3M (idx 4): residual 2M - 1.999M = 1K
    // Change 1.499M (idx 5) -> input 2.5M (idx 5): residual 1.5M - 1.499M = 1K
    // Change 999K (idx 16)  -> input 2M (idx 6): residual 1M - 999K = 1K
    // Change 499K (idx 17)  -> input 1.5M (idx 7): residual 500K - 499K = 1K
    // Change 199K (idx 18)  -> input 1.2M (idx 8): residual 200K - 199K = 1K
    let expected_det_links: Vec<(usize, usize)> = vec![
        (0, 0), (1, 1), (2, 2), (3, 3), (4, 4), (5, 5),
        (16, 6), (17, 7), (18, 8),
    ];
    for &(out_idx, in_idx) in &expected_det_links {
        assert!(
            turbo.deterministic_links.contains(&(out_idx, in_idx)),
            "JM turbo 10p: change at out[{out_idx}] should link to in[{in_idx}]"
        );
    }
    assert_eq!(turbo.deterministic_links.len(), 9, "JM turbo 10p: should have exactly 9 deterministic links");
}

// Turbo vs standard comparison on 3-party: CJ output cells should match
#[test]
fn test_jm_turbo_vs_standard_cj_cells() {
    let inputs = [150i64, 120, 106];
    let outputs = [100i64, 100, 100, 49, 19];
    let fee = 8i64;

    let standard = analyze(&inputs, &outputs, fee, 0.0, 60_000);
    let turbo = analyze_joinmarket(&inputs, &outputs, fee, 100, 0.0, 60_000);

    // CJ output rows (indices 0, 1, 2) - probabilities should be consistent
    // The turbo mode solves the reduced problem exactly, so CJ linkage should match
    // Turbo nb_cmbn may differ from standard since change links are forced deterministic
    assert!(turbo.nb_cmbn > 0);
    assert!(standard.nb_cmbn > 0);

    // Verify CJ output probabilities are proportionally consistent:
    // For each CJ row, the relative probabilities across inputs should be similar
    for out_idx in 0..3 {
        let turbo_row = &turbo.mat_lnk_probabilities[out_idx];
        let std_row = &standard.mat_lnk_probabilities[out_idx];
        // Both should have non-zero probabilities for CJ-relevant inputs
        for in_idx in 0..3 {
            assert!(
                turbo_row[in_idx] > 0.0,
                "Turbo CJ prob [{out_idx}][{in_idx}] should be > 0"
            );
            assert!(
                std_row[in_idx] > 0.0,
                "Standard CJ prob [{out_idx}][{in_idx}] should be > 0"
            );
        }
    }
}

// Real JM tx: ae988772 - 10 inputs, 18 outputs, 9 equal at 1,067,547
// User reported "raw is null" error in WASM
#[test]
fn test_jm_turbo_real_ae988772() {
    let inputs = [
        32_786_910i64, 1_100_260, 1_226_000, 267_116_955, 198_191_119,
        1_083_917, 1_100_000, 13_243_963, 1_137_509, 3_536_926,
    ];
    let outputs = [
        197_127_841i64, 1_067_547, 69_981, 36_722, 1_067_547,
        158_475, 36_982, 266_049_515, 1_067_547, 1_067_547,
        1_067_547, 1_067_547, 1_067_547, 12_176_575, 31_719_470,
        1_067_547, 2_469_698, 1_067_547,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let result = analyze_joinmarket(&inputs, &outputs, fee, 1_067_547, 0.005, 60_000);
    assert!(result.nb_cmbn > 0, "ae988772: should produce valid result");
    assert_eq!(result.n_inputs, 10);
    assert_eq!(result.n_outputs, 18);
}

// Real JM tx: 70fb6dfe - 11 inputs, 20 outputs, 10 equal at 1,137,509
// User reported 21 second compute time
#[test]
fn test_jm_turbo_real_70fb6dfe() {
    let inputs = [
        10_293_845i64, 82_353_594, 9_655_183, 1_165_442, 45_708_768,
        528_184_515, 1_161_185, 230_907_429, 1_289_261, 112_790_126,
        1_167_406,
    ];
    let outputs = [
        28_225i64, 32_482, 527_051_545, 151_772, 1_137_509,
        229_774_469, 44_575_792, 1_137_509, 1_137_509, 1_137_509,
        1_137_509, 9_156_392, 1_137_509, 111_652_843, 1_137_509,
        1_137_509, 81_216_199, 1_137_509, 1_137_509, 8_521_594,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let result = analyze_joinmarket(&inputs, &outputs, fee, 1_137_509, 0.005, 30_000);
    assert!(result.nb_cmbn > 0, "70fb6dfe: should produce valid result");
    assert_eq!(result.n_inputs, 11);
    assert_eq!(result.n_outputs, 20);
}

// Real tx: 08d91add - 11 inputs, 20 outputs, 10 equal at 136,363
// User reported "unreachable executed" error - test standard path
#[test]
fn test_standard_real_08d91add() {
    let inputs = [
        3_542_448i64, 1_721_507, 168_359, 116_800, 1_795_508,
        120_220, 422_302_747, 214_588, 173_099, 1_243_634,
        500_877,
    ];
    let outputs = [
        422_166_929i64, 1_659_445, 136_363, 136_363, 136_363,
        136_363, 3_410_606, 32_541, 136_363, 136_363,
        1_092_611, 36_739, 136_363, 78_228, 136_363,
        1_590_904, 365_514, 101_202, 136_363, 136_363,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    // This tx should not crash - test with short timeout
    let result = analyze(&inputs, &outputs, fee, 0.005, 10_000);
    assert_eq!(result.n_inputs, 11);
    assert_eq!(result.n_outputs, 20);
}

// Real tx: 08d91add - test via JM turbo path (what WASM actually calls)
// With 20 outputs and matching failure, should gracefully return degenerate
// result instead of crashing on standard analyze fallback
#[test]
fn test_jm_turbo_real_08d91add() {
    let inputs = [
        3_542_448i64, 1_721_507, 168_359, 116_800, 1_795_508,
        120_220, 422_302_747, 214_588, 173_099, 1_243_634,
        500_877,
    ];
    let outputs = [
        422_166_929i64, 1_659_445, 136_363, 136_363, 136_363,
        136_363, 3_410_606, 32_541, 136_363, 136_363,
        1_092_611, 36_739, 136_363, 78_228, 136_363,
        1_590_904, 365_514, 101_202, 136_363, 136_363,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    // Should not crash even if matching fails - returns degenerate for n_out > 18
    let result = analyze_joinmarket(&inputs, &outputs, fee, 136_363, 0.005, 10_000);
    assert_eq!(result.n_inputs, 11);
    assert_eq!(result.n_outputs, 20);
    assert!(result.nb_cmbn > 0, "08d91add JM turbo: should produce valid result");
}

// Real JM tx: 89633a49 - 10 inputs, 15 outputs, 8 equal at 1,035,806
// Regression: unmatched change outputs were showing 100% for all unmatched inputs,
// but a single input can't fund multiple unmatched changes simultaneously.
#[test]
fn test_jm_turbo_real_89633a49_no_false_deterministic() {
    let inputs = [
        3_676_408i64, 3_252_191, 2_594_240, 1_301_613, 1_067_547,
        1_063_910, 1_017_842, 995_265, 940_638, 273_847,
    ];
    let outputs = [
        2_646_252i64, 2_216_695, 1_558_640, 1_035_806, 1_035_806,
        1_035_806, 1_035_806, 1_035_806, 1_035_806, 1_035_806,
        1_035_806, 981_443, 265_829, 184_140, 32_246,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let result = analyze_joinmarket(&inputs, &outputs, fee, 1_035_806, 0.005, 60_000);

    assert_eq!(result.n_inputs, 10);
    assert_eq!(result.n_outputs, 15);
    assert!(result.nb_cmbn > 1, "89633a49: should have multiple interpretations");

    // Key regression check: unmatched change outputs (981,443 and 184,140)
    // should NOT show 100% probability for all unmatched inputs.
    // Sorted outputs: [2646252, 2216695, 1558640, 1035806x8, 981443, 265829, 184140, 32246]
    // Output index 11 = 981,443, output index 13 = 184,140
    // These are the unmatched changes that couldn't be matched to any input's residual.
    for &change_out_idx in &[11usize, 13] {
        let row = &result.mat_lnk_probabilities[change_out_idx];
        let deterministic_count = row.iter().filter(|&&p| (p - 1.0).abs() < 1e-10).count();
        assert!(
            deterministic_count <= 1,
            "89633a49: unmatched change output[{change_out_idx}] has {deterministic_count} cells at 100% \
             (should be at most 1 - a single input can't fund multiple changes)"
        );
    }

    // Matched change outputs SHOULD still be deterministic (1:1 maker match)
    // Output 0 (2,646,252) -> input 0 (3,676,408), residual 1,030,602 ~ change
    assert!(
        result.deterministic_links.iter().any(|&(o, _)| o == 0),
        "89633a49: matched change output 0 should have a deterministic link"
    );
}

// Real JM tx: 14bf21be - 32 inputs, 33 outputs, 17 equal at 11,012,281
// Large n_extra (15) triggers formula approximation path (DFS infeasible for 32 inputs)
#[test]
fn test_jm_turbo_real_14bf21be() {
    let inputs = [
        528_935_525i64, 65_048_511, 65_048_511, 25_966_292, 25_966_292,
        16_087_041, 13_877_746, 12_694_620, 11_580_180, 11_114_766,
        11_107_192, 10_408_828, 10_054_866, 9_643_199, 7_476_541,
        7_323_478, 6_845_085, 5_009_708, 3_490_339, 2_368_635,
        1_956_000, 1_594_247, 1_202_745, 991_664, 940_638,
        825_071, 678_681, 354_248, 342_063, 221_657, 74_019, 70_803,
    ];
    let outputs = [
        517_923_255i64, 54_037_215, 54_037_188, 14_955_112, 14_955_112,
        11_012_281, 11_012_281, 11_012_281, 11_012_281, 11_012_281,
        11_012_281, 11_012_281, 11_012_281, 11_012_281, 11_012_281,
        11_012_281, 11_012_281, 11_012_281, 11_012_281, 11_012_281,
        11_012_281, 11_012_281, 5_075_861, 3_788_839, 2_866_566,
        1_682_669, 1_038_553, 821_180, 568_119, 102_738,
        95_131, 81_019, 55_347,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let result = analyze_joinmarket(&inputs, &outputs, fee, 11_012_281, 0.005, 60_000);

    assert_eq!(result.n_inputs, 32);
    assert_eq!(result.n_outputs, 33);
    assert!(result.nb_cmbn > 1, "14bf21be: nb_cmbn should be > 1 (not degenerate)");
    assert!(result.entropy > 0.0, "14bf21be: entropy should be positive");
    assert!(!result.timed_out, "14bf21be: should not timeout");
    assert!(result.elapsed_ms < 5000, "14bf21be: should complete quickly, got {}ms", result.elapsed_ms);

    // CJ cell probabilities should be non-trivial (not 100% everywhere)
    let cj_prob = result.mat_lnk_probabilities[5][0]; // First CJ output row, first input
    assert!(cj_prob > 0.0, "14bf21be: CJ cell prob should be > 0");
    assert!(cj_prob < 1.0, "14bf21be: CJ cell prob should be < 1 (not degenerate)");

    // Should have deterministic change links (matched makers)
    assert!(!result.deterministic_links.is_empty(), "14bf21be: should have deterministic change links");
}

// Stress test: very large synthetic JM (50 inputs, 25 CJ outputs)
// Verifies the formula approximation path handles extreme sizes
#[test]
fn test_jm_turbo_50_inputs() {
    let mut inputs = Vec::new();
    // 24 makers with varied values above denomination
    for i in 0..24 {
        inputs.push(2_000_000i64 + (i as i64 + 1) * 50_000);
    }
    // 26 taker inputs (small values, collectively fund 1 CJ output)
    for _ in 0..26 {
        inputs.push(40_000);
    }

    let denomination = 1_000_000i64;
    let mut outputs = Vec::new();
    // 25 CJ denomination outputs
    for _ in 0..25 {
        outputs.push(denomination);
    }
    // 24 maker changes
    for i in 0..24 {
        outputs.push(inputs[i] - denomination - 500); // subtract maker fee
    }
    // 1 taker change
    let taker_total: i64 = inputs[24..].iter().sum();
    let total_fee = 5000i64;
    outputs.push(taker_total - denomination - total_fee);

    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let result = analyze_joinmarket(&inputs, &outputs, fee, denomination, 0.005, 10_000);

    assert_eq!(result.n_inputs, 50);
    assert!(result.nb_cmbn > 1, "50-input JM: should not be degenerate");
    assert!(result.entropy > 0.0, "50-input JM: should have positive entropy");
    assert!(!result.timed_out, "50-input JM: should not timeout");
    assert!(result.elapsed_ms < 5000, "50-input JM: should complete quickly");

    // CJ cells should not be 100%
    let cj_row_start = result.mat_lnk_probabilities.iter()
        .position(|row| row.iter().any(|&p| p > 0.0 && p < 0.99))
        .expect("Should have at least one CJ row with non-degenerate probabilities");
    let cj_prob = result.mat_lnk_probabilities[cj_row_start][0];
    assert!(cj_prob < 0.5, "50-input JM: CJ cell prob should be well below 50%, got {cj_prob}");
}
