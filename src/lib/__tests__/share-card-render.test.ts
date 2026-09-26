// @vitest-environment jsdom
/**
 * Renders both share card styles against a recording 2D context (jsdom has no
 * canvas), checking what ends up on the card and the PNG / share plumbing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateShareCard, sharePng } from "@/lib/share-card";

const TXID = "323df21f0b0756f98336437aa3d2fb87e02b59f1946b714a7b09df04d429dec2";

function recordingCanvas() {
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(target, prop: string) {
      if (prop === "fillText") return (s: string) => texts.push(String(s));
      if (prop === "measureText") return (s: string) => ({ width: String(s).length * 12 });
      if (prop === "createLinearGradient" || prop === "createRadialGradient") return () => ({ addColorStop: () => {} });
      if (prop in target) return target[prop];
      return () => {};
    },
    set(target, prop: string, value) { target[prop] = value; return true; },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob | null) => void) => cb(new Blob(["png"], { type: "image/png" })) };
  return { canvas, texts };
}

describe("share card rendering", () => {
  let rec: ReturnType<typeof recordingCanvas>;
  beforeEach(() => {
    rec = recordingCanvas();
    const orig = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => (tag === "canvas" ? rec.canvas : orig(tag))) as typeof document.createElement);
  });
  afterEach(() => vi.restoreAllMocks());

  it("draws the classic card and returns a PNG", async () => {
    const blob = await generateShareCard({ grade: "D", score: 34, query: TXID, inputType: "txid", findingCount: 7 });
    expect(blob.type).toBe("image/png");
    expect(rec.texts.join(" ")).toContain("34");
  });

  it("draws the v2 evidence card with grade, score, type and top leak", async () => {
    const blob = await generateShareCard({
      grade: "C", score: 50, query: TXID, inputType: "txid", findingCount: 9,
      style: "v2", txType: "Peel chain", topLeak: "Change output likely identifiable",
    });
    expect(blob.type).toBe("image/png");
    const all = rec.texts.join(" | ");
    for (const s of ["C", "50", "Peel chain", "Change output likely identifiable"]) expect(all).toContain(s);
    expect(all).toContain("323df21f");
  });

  it("draws the v2 card for an address without type or leak", async () => {
    await generateShareCard({ grade: "F", score: 0, query: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", inputType: "address", findingCount: 3, style: "v2" });
    expect(rec.texts.join(" ")).toContain("F");
  });

  it("fails clearly when the canvas cannot produce a PNG", async () => {
    rec.canvas.toBlob = (cb) => cb(null);
    await expect(generateShareCard({ grade: "B", score: 80, query: TXID, inputType: "txid", findingCount: 1 })).rejects.toThrow();
  });
});

describe("sharePng", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the share sheet when files can be shared", async () => {
    const share = vi.fn(async () => {});
    Object.assign(navigator, { share, canShare: () => true });
    await sharePng(new Blob(["x"], { type: "image/png" }), "card.png");
    expect(share).toHaveBeenCalledTimes(1);
  });

  it("falls back to a download link", async () => {
    Object.assign(navigator, { share: undefined, canShare: undefined });
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await sharePng(new Blob(["x"], { type: "image/png" }), "card.png");
    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
});
