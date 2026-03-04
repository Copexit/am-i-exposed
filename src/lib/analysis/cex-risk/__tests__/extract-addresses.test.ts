import { describe, it, expect } from "vitest";
import { extractTxAddresses } from "../extract-addresses";
import { makeTx, makeVin, makeVout } from "../../heuristics/__tests__/fixtures/tx-factory";

describe("extractTxAddresses", () => {
  it("extracts unique addresses from inputs and outputs", () => {
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qaddr1" + "0".repeat(32), value: 100_000 } }),
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: "bc1qaddr2" + "0".repeat(32), value: 50_000 } }),
      ],
      vout: [
        makeVout({ scriptpubkey_address: "bc1qaddr3" + "0".repeat(32) }),
        makeVout({ scriptpubkey_address: "bc1qaddr4" + "0".repeat(32) }),
      ],
    });
    const addrs = extractTxAddresses(tx);
    expect(addrs).toHaveLength(4);
  });

  it("deduplicates addresses", () => {
    const sameAddr = "bc1qsame0" + "0".repeat(32);
    const tx = makeTx({
      vin: [
        makeVin({ prevout: { scriptpubkey: "", scriptpubkey_asm: "", scriptpubkey_type: "v0_p2wpkh", scriptpubkey_address: sameAddr, value: 100_000 } }),
      ],
      vout: [
        makeVout({ scriptpubkey_address: sameAddr }),
        makeVout({ scriptpubkey_address: "bc1qother" + "0".repeat(32) }),
      ],
    });
    const addrs = extractTxAddresses(tx);
    expect(addrs).toHaveLength(2);
  });

  it("skips coinbase inputs", () => {
    const tx = makeTx({
      vin: [makeVin({ is_coinbase: true })],
      vout: [makeVout({ scriptpubkey_address: "bc1qminer" + "0".repeat(32) })],
    });
    const addrs = extractTxAddresses(tx);
    expect(addrs).toHaveLength(1);
    expect(addrs[0]).toContain("bc1qminer");
  });

  it("skips outputs without addresses", () => {
    const tx = makeTx({
      vin: [makeVin()],
      vout: [
        makeVout({ scriptpubkey_address: "bc1qaddr1" + "0".repeat(32) }),
        makeVout({ scriptpubkey_address: undefined, scriptpubkey_type: "op_return" }),
      ],
    });
    const addrs = extractTxAddresses(tx);
    // Input address + 1 output address (OP_RETURN skipped)
    expect(addrs.every((a) => a.includes("bc1q"))).toBe(true);
  });
});
