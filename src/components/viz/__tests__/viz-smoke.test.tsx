// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock react-i18next - return keys as-is
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
    i18n: { language: "en" },
  }),
}));

// Mock motion/react - render plain HTML/SVG elements instead of animated ones
vi.mock("motion/react", () => {
  const forwardMotionElement = (tag: string) => {
    const Comp = React.forwardRef((props: Record<string, unknown>, ref) => {
      // Strip motion-specific props before passing through
      const {
        initial: _i,
        animate: _a,
        exit: _e,
        transition: _t,
        whileHover: _wh,
        whileTap: _wt,
        variants: _v,
        ...rest
      } = props;
      return React.createElement(tag, { ...rest, ref });
    });
    Comp.displayName = `motion.${tag}`;
    return Comp;
  };

  return {
    motion: new Proxy(
      {},
      {
        get(_target, prop: string) {
          return forwardMotionElement(prop);
        },
      },
    ),
    useReducedMotion: () => true,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  };
});

// Mock @visx/responsive ParentSize - call children with a fixed width
vi.mock("@visx/responsive", () => ({
  ParentSize: ({
    children,
  }: {
    children: (size: { width: number; height: number }) => React.ReactNode;
    debounceTime?: number;
  }) => children({ width: 600, height: 400 }),
}));

// ---------------------------------------------------------------------------
// Types - minimal mock data builders
// ---------------------------------------------------------------------------

import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";

function makeCoinJoinTx(): MempoolTransaction {
  const denomSats = 1_000_000;
  const inputAddresses = [
    "bc1qaddr1aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bc1qaddr2bbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "bc1qaddr3cccccccccccccccccccccccccccc",
    "bc1qaddr4dddddddddddddddddddddddddd",
    "bc1qaddr5eeeeeeeeeeeeeeeeeeeeeeeeeeee",
  ];

  const vin = inputAddresses.map((addr, i) => ({
    txid: `input_txid_${i}`.padEnd(64, "0"),
    vout: 0,
    prevout: {
      scriptpubkey: "0014" + "aa".repeat(20),
      scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 " + "aa".repeat(20),
      scriptpubkey_type: "v0_p2wpkh",
      scriptpubkey_address: addr,
      value: denomSats + 500, // denom + fee contribution
    },
    scriptsig: "",
    scriptsig_asm: "",
    witness: ["3045...01", "02...pub"],
    is_coinbase: false,
    sequence: 0xfffffffd,
  }));

  const vout = inputAddresses.map((_addr, i) => ({
    scriptpubkey: "0014" + "bb".repeat(20),
    scriptpubkey_asm: "OP_0 OP_PUSHBYTES_20 " + "bb".repeat(20),
    scriptpubkey_type: "v0_p2wpkh",
    scriptpubkey_address: `bc1qout${i}ffffffffffffffffffffffffffffffff`,
    value: denomSats,
  }));

  return {
    txid: "coinjoin_txid".padEnd(64, "0"),
    version: 1,
    locktime: 0,
    size: 900,
    weight: 2400,
    fee: 2500,
    vin,
    vout,
    status: { confirmed: true, block_height: 800000, block_time: 1700000000 },
  };
}

function makeCoinJoinFindings(): Finding[] {
  return [
    {
      id: "h4-coinjoin-detected",
      severity: "good",
      title: "CoinJoin detected",
      description: "This transaction is a CoinJoin with 5 equal outputs.",
      recommendation: "No action needed.",
      scoreImpact: 10,
    },
  ];
}

function makeTaintFindings(): Finding[] {
  return [
    {
      id: "chain-taint-backward",
      severity: "medium",
      title: "Backward taint detected",
      description: "Some inputs trace back to a known entity.",
      recommendation: "Consider the source of funds.",
      scoreImpact: -5,
      params: { taintPct: 42 },
    },
    {
      id: "chain-entity-proximity-backward",
      severity: "high",
      title: "Entity proximity detected",
      description: "An exchange is 2 hops away in the input chain.",
      recommendation: "Funds may be traceable to a known entity.",
      scoreImpact: -10,
      params: {
        hops: 2,
        entityName: "SomeExchange",
        category: "exchange",
        entityTxid: "entity_txid".padEnd(64, "0"),
        entityAddress: "bc1qentityaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    },
    {
      id: "chain-trace-summary",
      severity: "low",
      title: "Trace summary",
      description: "Traced 3 hops backward and 2 hops forward.",
      recommendation: "Review the chain analysis panel for details.",
      scoreImpact: 0,
      params: { backwardDepth: 3, forwardDepth: 2 },
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Dynamic imports so mocks are applied first
const { CoinJoinStructure } = await import("../CoinJoinStructure");
const { TaintPathDiagram } = await import("../TaintPathDiagram");

describe("CoinJoinStructure smoke test", () => {
  it("renders without crashing given a mock CoinJoin transaction", () => {
    const tx = makeCoinJoinTx();
    const findings = makeCoinJoinFindings();

    expect(() => {
      render(
        <CoinJoinStructure tx={tx} findings={findings} />,
      );
    }).not.toThrow();
  });

  it("returns null when findings do not include a CoinJoin finding", () => {
    const tx = makeCoinJoinTx();
    const findings: Finding[] = [
      {
        id: "h1-address-reuse",
        severity: "medium",
        title: "Address reuse",
        description: "Reused address.",
        recommendation: "Avoid reuse.",
        scoreImpact: -5,
      },
    ];

    const { container } = render(
      <CoinJoinStructure tx={tx} findings={findings} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("TaintPathDiagram smoke test", () => {
  it("renders without crashing given mock taint findings", () => {
    const findings = makeTaintFindings();

    expect(() => {
      render(<TaintPathDiagram findings={findings} />);
    }).not.toThrow();
  });

  it("returns null when no chain analysis findings are present", () => {
    const findings: Finding[] = [
      {
        id: "h1-address-reuse",
        severity: "medium",
        title: "Address reuse",
        description: "Reused address.",
        recommendation: "Avoid reuse.",
        scoreImpact: -5,
      },
    ];

    const { container } = render(
      <TaintPathDiagram findings={findings} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
