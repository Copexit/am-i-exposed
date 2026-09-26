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
vi.mock("@/components/Header", () => ({ Header: Empty }));
vi.mock("@/components/Footer", () => ({ Footer: Empty }));
vi.mock("@/components/PrivacyNotice", () => ({ PrivacyNotice: Empty }));
vi.mock("@/components/MempoolDownDialog", () => ({ MempoolDownDialog: Empty }));
vi.mock("@/components/AmbientBackground", () => ({ AmbientBackground: Empty }));

import RootLayout from "../layout";

describe("RootLayout", () => {
  it("has no static connection hints to mempool.space (would leak for Umbrel/Tor/custom API users)", () => {
    const html = renderToStaticMarkup(<RootLayout><main /></RootLayout>);
    expect(html).toContain("<head>");
    expect(html).not.toMatch(/<link[^>]+rel="(preconnect|dns-prefetch)"[^>]*mempool\.space/);
  });
});
