/* tslint:disable */
/* eslint-disable */

/**
 * Compute the Boltzmann Link Probability Matrix for a Bitcoin transaction.
 *
 * # Arguments
 * * `input_values` - Input amounts in satoshis
 * * `output_values` - Output amounts in satoshis
 * * `fee` - Transaction fee in satoshis
 * * `max_cj_intrafees_ratio` - Max intrafees ratio (0.0 or 0.005 typically)
 * * `timeout_ms` - Maximum computation time in milliseconds
 *
 * # Returns
 * A JsValue containing the serialized BoltzmannResult.
 */
export function compute_boltzmann(input_values: BigInt64Array, output_values: BigInt64Array, fee: bigint, max_cj_intrafees_ratio: number, timeout_ms: number): any;

/**
 * Finalize the chunked Boltzmann analysis and return the full result.
 *
 * Must be called after `dfs_step` returns `done: true`.
 * Consumes the stored state.
 */
export function dfs_finalize(): any;

/**
 * Run one chunk of the DFS computation.
 *
 * Runs the DFS loop for up to `chunk_ms` milliseconds, then returns
 * progress information. Call repeatedly until `done` is true.
 */
export function dfs_step(chunk_ms: number): any;

/**
 * Prepare for chunked Boltzmann analysis.
 *
 * Runs sorting, intrafees detection, and Phase 1+2 (aggregate matching +
 * input decomposition). Stores state for subsequent `dfs_step` calls.
 *
 * Returns a PrepareResult with metadata about the computation.
 */
export function prepare_boltzmann(input_values: BigInt64Array, output_values: BigInt64Array, fee: bigint, max_cj_intrafees_ratio: number, timeout_ms: number): any;

/**
 * Prepare a ranged Boltzmann computation for multi-worker parallelism.
 *
 * Each worker calls this with its `worker_index` (0-based) and `total_workers`.
 * Phase 1+2 run internally, then a `DfsState` is created restricted to the
 * worker's assigned slice of root branches.
 *
 * `fees_maker` and `fees_taker` are provided explicitly (not computed from ratio)
 * so each worker can independently handle both dual-run passes.
 */
export function prepare_boltzmann_ranged(input_values: BigInt64Array, output_values: BigInt64Array, fee: bigint, fees_maker: bigint, fees_taker: bigint, timeout_ms: number, worker_index: number, total_workers: number): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compute_boltzmann: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number) => any;
    readonly dfs_finalize: () => any;
    readonly dfs_step: (a: number) => any;
    readonly prepare_boltzmann: (a: number, b: number, c: number, d: number, e: bigint, f: number, g: number) => any;
    readonly prepare_boltzmann_ranged: (a: number, b: number, c: number, d: number, e: bigint, f: bigint, g: bigint, h: number, i: number, j: number) => any;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
