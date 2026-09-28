import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "font-sans" }),
  Geist_Mono: () => ({ variable: "font-mono" }),
}));
const { Passthrough, Empty } = vi.hoisted(() => ({
  Passthrough: ({ children }: { children?: React.ReactNode }) => children,
  Empty: () => null,
}));
vi.mock("@/context/NetworkContext", () => ({ NetworkProvider: Passthrough }));
vi.mock("@/lib/i18n/I18nProvider", () => ({ I18nProvider: Passthrough }));
vi.mock("@/lib/i18n/LangAttributeSync", () => ({ LangAttributeSync: Empty }));
vi.mock("@/components/v2/chrome/V2Header", () => ({ V2Header: Empty }));
vi.mock("@/components/v2/chrome/V2Footer", () => ({ V2Footer: Empty }));
vi.mock("@/components/v2/chrome/V2PrivacyNotice", () => ({ V2PrivacyNotice: Empty }));
vi.mock("@/components/MempoolDownDialog", () => ({ MempoolDownDialog: Empty }));

import RootLayout from "../layout";
import { V2_COLORS, V2_LIGHT_COLORS } from "@/lib/palette";

describe("RootLayout", () => {
  it("has no static connection hints to mempool.space (would leak for Umbrel/Tor/custom API users)", () => {
    const html = renderToStaticMarkup(<RootLayout><main /></RootLayout>);
    expect(html).toContain("<head>");
    expect(html).not.toMatch(/<link[^>]+rel="(preconnect|dns-prefetch)"[^>]*mempool\.space/);
  });

  it("pre-paint theme script applies the stored preference, else the OS preference, and the matching theme color", () => {
    const html = renderToStaticMarkup(<RootLayout><main /></RootLayout>);
    const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!).find((c) => c.includes("ami-theme"));
    expect(code).toBeDefined();
    expect(html).toContain(`<meta name="theme-color" content="${V2_COLORS.background}"`);
    const run = (stored: string | null, osLight: boolean) => {
      const dataset: Record<string, string> = {};
      const meta = { content: "" };
      new Function("localStorage", "document", "matchMedia", code!)(
        { getItem: () => stored },
        { documentElement: { dataset }, getElementById: () => meta },
        () => ({ matches: osLight }),
      );
      return { theme: dataset.theme, meta: meta.content };
    };
    expect(run(null, true)).toEqual({ theme: "light", meta: V2_LIGHT_COLORS.background });
    expect(run(null, false).theme).toBeUndefined();
    expect(run("light", false).theme).toBe("light");
    expect(run("dark", true).theme).toBeUndefined();
  });
});
