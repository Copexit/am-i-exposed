import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGraphExpansion } from "../useGraphExpansion";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";

// ---------------------------------------------------------------------------
// Helpers - minimal MempoolTransaction factory
// ---------------------------------------------------------------------------

let txCounter = 0;

function makeTx(overrides: Partial<MempoolTransaction> & { txid: string }): MempoolTransaction {
  txCounter++;
  return {
    version: 2,
    locktime: 0,
    size: 250,
    weight: 660,
    fee: 1000,
    vin: [],
    vout: [],
    status: { confirmed: true, block_height: 800000 + txCounter, block_time: 1700000000 + txCounter },
    ...overrides,
  };
}

function makeVin(parentTxid: string, voutIndex = 0) {
  return {
    txid: parentTxid,
    vout: voutIndex,
    prevout: {
      scriptpubkey: "0014aabbccdd",
      scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 aabbccdd",
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: "bc1qtest",
      value: 50000,
    },
    scriptsig: "",
    scriptsig_asm: "",
    witness: [],
    is_coinbase: false,
    sequence: 0xfffffffd,
  };
}

function makeVout(value: number, index?: number) {
  void index; // unused but clarifies intent at call sites
  return {
    scriptpubkey: "0014eeff0011",
    scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 eeff0011",
    scriptpubkey_type: "v0_p2wpkh",
    scriptpubkey_address: "bc1qout",
    value,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useGraphExpansion", () => {
  // ── Root initialization ────────────────────────────────────────────────

  describe("root initialization", () => {
    it("setRoot creates the initial graph with one node at depth 0", () => {
      const rootTx = makeTx({ txid: "root-aaa" });
      const { result } = renderHook(() => useGraphExpansion(null));

      act(() => {
        result.current.setRoot(rootTx);
      });

      expect(result.current.nodes.size).toBe(1);
      expect(result.current.rootTxid).toBe("root-aaa");
      const rootNode = result.current.nodes.get("root-aaa");
      expect(rootNode).toBeDefined();
      expect(rootNode!.depth).toBe(0);
      expect(rootNode!.tx.txid).toBe("root-aaa");
      expect(result.current.canUndo).toBe(false);
    });

    it("setRootWithNeighbors adds parent and child nodes around the root", () => {
      const parentTx = makeTx({ txid: "parent-111" });
      const childTx = makeTx({
        txid: "child-222",
        vin: [makeVin("root-bbb", 0)],
      });
      const rootTx = makeTx({
        txid: "root-bbb",
        vin: [makeVin("parent-111", 0)],
        vout: [makeVout(40000)],
      });

      const parents = new Map([["parent-111", parentTx]]);
      const children = new Map<number, MempoolTransaction>([[0, childTx]]);

      const { result } = renderHook(() => useGraphExpansion(null));

      act(() => {
        result.current.setRootWithNeighbors(rootTx, parents, children);
      });

      expect(result.current.nodes.size).toBe(3);
      expect(result.current.rootTxid).toBe("root-bbb");

      const pNode = result.current.nodes.get("parent-111");
      expect(pNode).toBeDefined();
      expect(pNode!.depth).toBe(-1);
      expect(pNode!.childEdge).toEqual({ toTxid: "root-bbb", inputIndex: 0 });

      const cNode = result.current.nodes.get("child-222");
      expect(cNode).toBeDefined();
      expect(cNode!.depth).toBe(1);
      expect(cNode!.parentEdge).toEqual({ fromTxid: "root-bbb", outputIndex: 0 });

      // setRootWithNeighbors is an initialization, not undoable
      expect(result.current.canUndo).toBe(false);
    });
  });

  // ── Layer expansion (ADD_NODE via expandInput/expandOutput) ────────────

  describe("layer expansion", () => {
    it("expandInput fetches a parent tx and adds it at depth -1", async () => {
      const parentTx = makeTx({ txid: "parent-333" });
      const rootTx = makeTx({
        txid: "root-ccc",
        vin: [makeVin("parent-333", 0)],
        vout: [makeVout(40000)],
      });

      const fetcher = {
        getTransaction: vi.fn().mockResolvedValue(parentTx),
        getTxOutspends: vi.fn().mockResolvedValue([]),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRoot(rootTx);
      });

      await act(async () => {
        await result.current.expandInput("root-ccc", 0);
      });

      expect(fetcher.getTransaction).toHaveBeenCalledWith("parent-333");
      expect(result.current.nodes.size).toBe(2);

      const pNode = result.current.nodes.get("parent-333");
      expect(pNode).toBeDefined();
      expect(pNode!.depth).toBe(-1);
      expect(pNode!.childEdge).toEqual({ toTxid: "root-ccc", inputIndex: 0 });
      expect(result.current.canUndo).toBe(true);
    });

    it("expandOutput fetches a child tx and adds it at depth +1", async () => {
      const childTx = makeTx({
        txid: "child-444",
        vin: [makeVin("root-ddd", 0)],
      });
      const rootTx = makeTx({
        txid: "root-ddd",
        vin: [makeVin("some-prev", 0)],
        vout: [makeVout(30000)],
      });

      const outspends: MempoolOutspend[] = [
        { spent: true, txid: "child-444", vin: 0, status: { confirmed: true } },
      ];

      const fetcher = {
        getTransaction: vi.fn().mockResolvedValue(childTx),
        getTxOutspends: vi.fn().mockResolvedValue(outspends),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRoot(rootTx);
      });

      await act(async () => {
        await result.current.expandOutput("root-ddd", 0);
      });

      expect(fetcher.getTxOutspends).toHaveBeenCalledWith("root-ddd");
      expect(fetcher.getTransaction).toHaveBeenCalledWith("child-444");
      expect(result.current.nodes.size).toBe(2);

      const cNode = result.current.nodes.get("child-444");
      expect(cNode).toBeDefined();
      expect(cNode!.depth).toBe(1);
      expect(cNode!.parentEdge).toEqual({ fromTxid: "root-ddd", outputIndex: 0 });
    });

    it("does not add a node that already exists", async () => {
      const parentTx = makeTx({ txid: "parent-dup" });
      const rootTx = makeTx({
        txid: "root-eee",
        vin: [makeVin("parent-dup", 0), makeVin("parent-dup", 1)],
      });

      const fetcher = {
        getTransaction: vi.fn().mockResolvedValue(parentTx),
        getTxOutspends: vi.fn().mockResolvedValue([]),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRoot(rootTx);
      });

      // First expansion adds parent-dup
      await act(async () => {
        await result.current.expandInput("root-eee", 0);
      });
      expect(result.current.nodes.size).toBe(2);

      // Second expansion for the same parent should be a no-op
      await act(async () => {
        await result.current.expandInput("root-eee", 1);
      });
      // Still 2 nodes - the duplicate was skipped
      expect(result.current.nodes.size).toBe(2);
      // getTransaction should only have been called once (skipped on second call)
      expect(fetcher.getTransaction).toHaveBeenCalledTimes(1);
    });

    it("sets an error when fetch fails", async () => {
      const rootTx = makeTx({
        txid: "root-err",
        vin: [makeVin("fail-parent", 0)],
      });

      const fetcher = {
        getTransaction: vi.fn().mockRejectedValue(new Error("Network timeout")),
        getTxOutspends: vi.fn().mockResolvedValue([]),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRoot(rootTx);
      });

      await act(async () => {
        await result.current.expandInput("root-err", 0);
      });

      // Node should NOT have been added
      expect(result.current.nodes.size).toBe(1);
      // Error should be recorded
      expect(result.current.errors.get("fail-parent")).toBe("Network timeout");
    });
  });

  // ── MAX_NODES cap ─────────────────────────────────────────────────────

  describe("MAX_NODES cap", () => {
    it("does not exceed the maximum node count via ADD_NODE", () => {
      // Build a root with 110 inputs so we can attempt to add 110 parents
      const parentIds = Array.from({ length: 110 }, (_, i) => `p-${String(i).padStart(3, "0")}`);
      const rootTx = makeTx({
        txid: "root-cap",
        vin: parentIds.map((pid) => makeVin(pid, 0)),
      });

      const { result } = renderHook(() => useGraphExpansion(null));

      act(() => {
        result.current.setRoot(rootTx);
      });

      // Manually dispatch ADD_NODE for each parent to test the cap
      // We use setRootWithNeighbors with a large parent map instead
      const parents = new Map(
        parentIds.map((pid) => [pid, makeTx({ txid: pid })])
      );
      const children = new Map<number, MempoolTransaction>();

      act(() => {
        result.current.setRootWithNeighbors(rootTx, parents, children);
      });

      // maxNodes is 100, so the graph should have at most 100 nodes
      expect(result.current.nodes.size).toBeLessThanOrEqual(result.current.maxNodes);
      expect(result.current.maxNodes).toBe(100);
      // Root + 99 parents = 100 max
      expect(result.current.nodes.size).toBe(100);
    });

    it("expandInput is a no-op when graph is already at MAX_NODES", async () => {
      // Create a root with many inputs
      const parentIds = Array.from({ length: 105 }, (_, i) => `cap-${i}`);
      const rootTx = makeTx({
        txid: "root-full",
        vin: parentIds.map((pid) => makeVin(pid, 0)),
      });

      // Pre-fill graph to MAX_NODES using setRootWithNeighbors
      const parents = new Map(
        parentIds.map((pid) => [pid, makeTx({ txid: pid })])
      );
      const children = new Map<number, MempoolTransaction>();

      const fetcher = {
        getTransaction: vi.fn().mockResolvedValue(makeTx({ txid: "extra-node" })),
        getTxOutspends: vi.fn().mockResolvedValue([]),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRootWithNeighbors(rootTx, parents, children);
      });

      expect(result.current.nodes.size).toBe(100);

      // Try expanding - should not add anything
      await act(async () => {
        await result.current.expandInput("root-full", 100);
      });

      expect(result.current.nodes.size).toBe(100);
      // Fetcher should not have been called since we bail early
      expect(fetcher.getTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Undo ──────────────────────────────────────────────────────────────

  describe("undo", () => {
    it("removes the last expanded node", async () => {
      const parentTx = makeTx({ txid: "parent-undo" });
      const rootTx = makeTx({
        txid: "root-undo",
        vin: [makeVin("parent-undo", 0)],
      });

      const fetcher = {
        getTransaction: vi.fn().mockResolvedValue(parentTx),
        getTxOutspends: vi.fn().mockResolvedValue([]),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRoot(rootTx);
      });

      await act(async () => {
        await result.current.expandInput("root-undo", 0);
      });
      expect(result.current.nodes.size).toBe(2);
      expect(result.current.canUndo).toBe(true);

      act(() => {
        result.current.undo();
      });

      expect(result.current.nodes.size).toBe(1);
      expect(result.current.nodes.has("parent-undo")).toBe(false);
      expect(result.current.nodes.has("root-undo")).toBe(true);
      expect(result.current.canUndo).toBe(false);
    });

    it("undoes multiple expansions in reverse order", async () => {
      const rootTx = makeTx({
        txid: "root-multi",
        vin: [makeVin("p1"), makeVin("p2"), makeVin("p3")],
      });
      const p1 = makeTx({ txid: "p1" });
      const p2 = makeTx({ txid: "p2" });
      const p3 = makeTx({ txid: "p3" });

      let callCount = 0;
      const fetcher = {
        getTransaction: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.resolve(p1);
          if (callCount === 2) return Promise.resolve(p2);
          return Promise.resolve(p3);
        }),
        getTxOutspends: vi.fn().mockResolvedValue([]),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRoot(rootTx);
      });

      // Expand 3 parents one by one (each creates an undo snapshot)
      await act(async () => {
        await result.current.expandInput("root-multi", 0);
      });
      expect(result.current.nodes.size).toBe(2);

      await act(async () => {
        await result.current.expandInput("root-multi", 1);
      });
      expect(result.current.nodes.size).toBe(3);

      await act(async () => {
        await result.current.expandInput("root-multi", 2);
      });
      expect(result.current.nodes.size).toBe(4);

      // Undo in reverse order
      act(() => {
        result.current.undo();
      });
      expect(result.current.nodes.size).toBe(3);

      act(() => {
        result.current.undo();
      });
      expect(result.current.nodes.size).toBe(2);

      act(() => {
        result.current.undo();
      });
      expect(result.current.nodes.size).toBe(1);
      expect(result.current.nodes.has("root-multi")).toBe(true);
      expect(result.current.canUndo).toBe(false);
    });

    it("undo is a no-op when history is empty", () => {
      const rootTx = makeTx({ txid: "root-noop" });
      const { result } = renderHook(() => useGraphExpansion(null));

      act(() => {
        result.current.setRoot(rootTx);
      });

      // Undo with no history should not throw or change state
      act(() => {
        result.current.undo();
      });

      expect(result.current.nodes.size).toBe(1);
      expect(result.current.rootTxid).toBe("root-noop");
    });
  });

  // ── Reset ─────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("returns to initial state with only the root node", async () => {
      const parentTx = makeTx({ txid: "parent-rst" });
      const rootTx = makeTx({
        txid: "root-rst",
        vin: [makeVin("parent-rst", 0)],
        vout: [makeVout(25000)],
      });

      const fetcher = {
        getTransaction: vi.fn().mockResolvedValue(parentTx),
        getTxOutspends: vi.fn().mockResolvedValue([]),
      };

      const { result } = renderHook(() => useGraphExpansion(fetcher));

      act(() => {
        result.current.setRoot(rootTx);
      });

      await act(async () => {
        await result.current.expandInput("root-rst", 0);
      });
      expect(result.current.nodes.size).toBe(2);

      act(() => {
        result.current.reset();
      });

      expect(result.current.nodes.size).toBe(1);
      expect(result.current.nodes.has("root-rst")).toBe(true);
      expect(result.current.nodes.has("parent-rst")).toBe(false);
      expect(result.current.canUndo).toBe(false);
      expect(result.current.loading.size).toBe(0);
      expect(result.current.errors.size).toBe(0);
    });

    it("reset after setRootWithNeighbors keeps only the root", () => {
      const rootTx = makeTx({
        txid: "root-rst2",
        vin: [makeVin("p-rst")],
        vout: [makeVout(10000)],
      });
      const parents = new Map([["p-rst", makeTx({ txid: "p-rst" })]]);
      const children = new Map<number, MempoolTransaction>([
        [0, makeTx({ txid: "c-rst", vin: [makeVin("root-rst2", 0)] })],
      ]);

      const { result } = renderHook(() => useGraphExpansion(null));

      act(() => {
        result.current.setRootWithNeighbors(rootTx, parents, children);
      });
      expect(result.current.nodes.size).toBe(3);

      act(() => {
        result.current.reset();
      });

      expect(result.current.nodes.size).toBe(1);
      expect(result.current.rootTxid).toBe("root-rst2");
      expect(result.current.canUndo).toBe(false);
    });
  });

  // ── Collapse (REMOVE_NODE) ────────────────────────────────────────────

  describe("collapse", () => {
    it("removes a non-root node", () => {
      const rootTx = makeTx({
        txid: "root-col",
        vin: [makeVin("p-col")],
      });
      const parents = new Map([["p-col", makeTx({ txid: "p-col" })]]);
      const children = new Map<number, MempoolTransaction>();

      const { result } = renderHook(() => useGraphExpansion(null));

      act(() => {
        result.current.setRootWithNeighbors(rootTx, parents, children);
      });
      expect(result.current.nodes.size).toBe(2);

      act(() => {
        result.current.collapse("p-col");
      });
      expect(result.current.nodes.size).toBe(1);
      expect(result.current.nodes.has("p-col")).toBe(false);
    });

    it("cannot collapse the root node", () => {
      const rootTx = makeTx({ txid: "root-protect" });
      const { result } = renderHook(() => useGraphExpansion(null));

      act(() => {
        result.current.setRoot(rootTx);
      });

      act(() => {
        result.current.collapse("root-protect");
      });

      // Root should still be there
      expect(result.current.nodes.size).toBe(1);
      expect(result.current.nodes.has("root-protect")).toBe(true);
    });
  });

  // ── nodeCount and maxNodes ────────────────────────────────────────────

  describe("metadata", () => {
    it("nodeCount reflects the current graph size", () => {
      const rootTx = makeTx({
        txid: "root-meta",
        vin: [makeVin("p-meta")],
      });

      const { result } = renderHook(() => useGraphExpansion(null));

      expect(result.current.nodeCount).toBe(0);

      act(() => {
        result.current.setRoot(rootTx);
      });
      expect(result.current.nodeCount).toBe(1);
    });

    it("maxNodes is 100", () => {
      const { result } = renderHook(() => useGraphExpansion(null));
      expect(result.current.maxNodes).toBe(100);
    });
  });
});
