//! Test WASM serialization with large u64 values (BigInt mode).
//! Run with: wasm-pack test --node

#![cfg(target_arch = "wasm32")]

use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

/// Helper to serialize with BigInt support (same as lib.rs to_js)
fn to_js_bigint<T: serde::Serialize>(value: &T) -> Result<JsValue, serde_wasm_bindgen::Error> {
    let serializer = serde_wasm_bindgen::Serializer::new()
        .serialize_large_number_types_as_bigints(true);
    value.serialize(&serializer)
}

/// Verify that large u64 values serialize correctly as BigInt
#[wasm_bindgen_test]
fn test_serialize_large_u64_bigint() {
    let large: u64 = 132_737_352_875_454_782; // > 2^53
    let js = to_js_bigint(&large);
    assert!(js.is_ok(), "large u64 should serialize with BigInt: {:?}", js.err());
}

/// Verify that u64::MAX serializes correctly
#[wasm_bindgen_test]
fn test_serialize_u64_max_bigint() {
    let max: u64 = u64::MAX;
    let js = to_js_bigint(&max);
    assert!(js.is_ok(), "u64::MAX should serialize with BigInt: {:?}", js.err());
}

/// Verify that default serializer rejects large u64 (documenting the root cause)
#[wasm_bindgen_test]
fn test_default_serializer_rejects_large_u64() {
    let large: u64 = 132_737_352_875_454_782;
    let js = serde_wasm_bindgen::to_value(&large);
    assert!(js.is_err(), "default serializer should reject u64 > MAX_SAFE_INTEGER");
}

/// Test: JoinMarket WASM path for ae988772 (was failing with null result)
#[wasm_bindgen_test]
fn test_jm_wasm_ae988772() {
    let inputs: Vec<i64> = vec![
        32_786_910, 1_100_260, 1_226_000, 267_116_955, 198_191_119,
        1_083_917, 1_100_000, 13_243_963, 1_137_509, 3_536_926,
    ];
    let outputs: Vec<i64> = vec![
        197_127_841, 1_067_547, 69_981, 36_722, 1_067_547,
        158_475, 36_982, 266_049_515, 1_067_547, 1_067_547,
        1_067_547, 1_067_547, 1_067_547, 12_176_575, 31_719_470,
        1_067_547, 2_469_698, 1_067_547,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let result = boltzmann_rs::compute_boltzmann_joinmarket(
        &inputs, &outputs, fee, 1_067_547, 0.005, 60_000,
    );

    assert_ne!(result, JsValue::NULL, "ae988772 JM: WASM returned null result");
    assert!(result.is_object(), "ae988772 JM: result should be a JS object");

    let mat = js_sys::Reflect::get(&result, &"mat_lnk_combinations".into())
        .expect("should have mat_lnk_combinations field");
    assert!(js_sys::Array::is_array(&mat), "mat_lnk_combinations should be an array");
    assert_eq!(js_sys::Array::from(&mat).length(), 18, "should have 18 output rows");
}

/// Test: Standard WASM path for ae988772
#[wasm_bindgen_test]
fn test_standard_wasm_ae988772() {
    let inputs: Vec<i64> = vec![
        32_786_910, 1_100_260, 1_226_000, 267_116_955, 198_191_119,
        1_083_917, 1_100_000, 13_243_963, 1_137_509, 3_536_926,
    ];
    let outputs: Vec<i64> = vec![
        197_127_841, 1_067_547, 69_981, 36_722, 1_067_547,
        158_475, 36_982, 266_049_515, 1_067_547, 1_067_547,
        1_067_547, 1_067_547, 1_067_547, 12_176_575, 31_719_470,
        1_067_547, 2_469_698, 1_067_547,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let result = boltzmann_rs::compute_boltzmann(&inputs, &outputs, fee, 0.005, 60_000);
    assert_ne!(result, JsValue::NULL, "ae988772 standard: WASM returned null result");
    assert!(result.is_object(), "ae988772 standard: result should be a JS object");
}

/// Test: Chunked WASM path for ae988772
#[wasm_bindgen_test]
fn test_chunked_wasm_ae988772() {
    let inputs: Vec<i64> = vec![
        32_786_910, 1_100_260, 1_226_000, 267_116_955, 198_191_119,
        1_083_917, 1_100_000, 13_243_963, 1_137_509, 3_536_926,
    ];
    let outputs: Vec<i64> = vec![
        197_127_841, 1_067_547, 69_981, 36_722, 1_067_547,
        158_475, 36_982, 266_049_515, 1_067_547, 1_067_547,
        1_067_547, 1_067_547, 1_067_547, 12_176_575, 31_719_470,
        1_067_547, 2_469_698, 1_067_547,
    ];
    let fee: i64 = inputs.iter().sum::<i64>() - outputs.iter().sum::<i64>();

    let prep = boltzmann_rs::prepare_boltzmann(&inputs, &outputs, fee, 0.005, 60_000);
    assert!(prep.is_object(), "prepare result should be an object");

    loop {
        let step = boltzmann_rs::dfs_step(500.0);
        assert!(step.is_object(), "step result should be an object");
        let done = js_sys::Reflect::get(&step, &"done".into()).unwrap();
        if done.is_truthy() { break; }
    }

    let result = boltzmann_rs::dfs_finalize();
    assert_ne!(result, JsValue::NULL, "ae988772 chunked: WASM returned null result");
    assert!(result.is_object(), "ae988772 chunked: result should be a JS object");
}

/// Test: Small transaction (should always work)
#[wasm_bindgen_test]
fn test_small_tx_wasm() {
    let inputs: Vec<i64> = vec![10000, 20000];
    let outputs: Vec<i64> = vec![15000, 14000];
    let result = boltzmann_rs::compute_boltzmann(&inputs, &outputs, 1000, 0.0, 10000);
    assert_ne!(result, JsValue::NULL, "2x2 tx should not return null");
    assert!(result.is_object(), "2x2 tx should return an object");
}
