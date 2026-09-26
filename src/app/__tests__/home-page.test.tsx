// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({ pendingHash: true }));

vi.mock("react-i18next", async (orig) => ({
  ...(await orig<object>()),
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k }),
}));
vi.mock("@/hooks/useAnalysis", () => ({
  useAnalysis: () => ({ phase: "idle", steps: [], analyze: vi.fn(), reset: vi.fn() }),
}));
vi.mock("@/hooks/useWalletAnalysis", () => ({
  useWalletAnalysis: () => ({ phase: "idle", analyze: vi.fn(), reset: vi.fn() }),
}));
vi.mock("@/context/NetworkContext", () => ({
  useNetwork: () => ({ customApiUrl: null, isUmbrel: false, config: {} }),
}));
vi.mock("@/hooks/useRecentScans", () => ({ useRecentScans: () => ({ scans: [], addScan: vi.fn(), clearScans: vi.fn() }) }));
vi.mock("@/hooks/useBookmarks", () => ({ useBookmarks: () => ({ bookmarks: [] }) }));
vi.mock("@/hooks/useKeyboardNav", () => ({ useKeyboardNav: () => {} }));
vi.mock("@/hooks/useHashRouting", () => ({
  useHashRouting: () => ({ pendingHash: h.pendingHash, dismissPendingHash: vi.fn(), skipNextHashChangeRef: { current: false } }),
}));
vi.mock("@/components/HeroSection", () => ({ HeroSection: () => <div>hero</div> }));
vi.mock("@/components/InstallPrompt", () => ({ InstallPrompt: () => null }));
vi.mock("@/components/AppStoreAnnouncement", () => ({ AppStoreAnnouncement: () => null }));

import Home from "../page";

afterEach(cleanup);

describe("Home page deep link", () => {
  it("shows a loading state (not a blank page) while a deep link waits for the backend", () => {
    render(<Home />);
    expect(screen.queryByText("hero")).toBeNull();
    expect(screen.getByTestId("pending-hash-loader")).toBeTruthy();
  });
});
