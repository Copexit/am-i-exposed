// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, screen, cleanup, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts?.defaultValue as string) ?? key,
  }),
}));

const network = vi.hoisted(() => ({ value: { isUmbrel: false } }));
vi.mock("@/context/NetworkContext", () => ({ useNetwork: () => network.value }));

import { InstallPrompt } from "../InstallPrompt";

/** Mounts the prompt on the given visit and fires the browser's install event. */
async function mountOnVisit(visit: number) {
  localStorage.setItem("ami-visit-count", String(visit - 1));
  render(<InstallPrompt />);
  await act(async () => { vi.runAllTimers(); });
  const e = Object.assign(new Event("beforeinstallprompt"), {
    prompt: () => Promise.resolve(),
    userChoice: Promise.resolve({ outcome: "dismissed" as const }),
  });
  await act(async () => { window.dispatchEvent(e); });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("InstallPrompt", () => {
  it("shows on the public site from the fifth visit, with no other precondition", async () => {
    network.value = { isUmbrel: false };
    await mountOnVisit(5);
    expect(screen.queryAllByRole("button").length).toBeGreaterThan(0);
  });

  it("stays hidden on the public site before the fifth visit", async () => {
    network.value = { isUmbrel: false };
    await mountOnVisit(4);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows on Umbrel on the first visit", async () => {
    network.value = { isUmbrel: true };
    await mountOnVisit(1);
    expect(screen.queryAllByRole("button").length).toBeGreaterThan(0);
  });
});
