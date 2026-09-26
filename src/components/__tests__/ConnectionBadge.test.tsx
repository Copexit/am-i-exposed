// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.defaultValue as string) ?? key,
  }),
}));

const network = vi.hoisted(() => ({
  value: { torStatus: "clearnet", localApiStatus: "unavailable", isUmbrel: false, customApiUrl: null as string | null },
}));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => network.value }));

import { ConnectionBadge } from "../ConnectionBadge";

afterEach(cleanup);

describe("ConnectionBadge", () => {
  it("warns about clearnet on the default API", () => {
    network.value = { ...network.value, customApiUrl: null };
    render(<ConnectionBadge />);
    expect(screen.getByRole("button").getAttribute("aria-label")).toMatch(/mempool\.space can see your IP/);
  });

  it("does not claim clearnet to mempool.space with a custom API (Tor detection is skipped)", () => {
    network.value = { ...network.value, customApiUrl: "http://node.onion/api" };
    render(<ConnectionBadge />);
    const label = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(label).not.toMatch(/can see your IP/);
    expect(label).toMatch(/custom API/);
  });
});
