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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { initial, animate, exit, transition, whileHover, whileTap, variants, ...rest } = props;
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

import type { Finding } from "@/lib/types";

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
const { TaintPathDiagram } = await import("../TaintPathDiagram");

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
        id: "h8-address-reuse",
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
