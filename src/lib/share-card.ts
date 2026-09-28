import type { Grade } from "@/lib/types";
import { GRADE_HEX } from "@/lib/constants";
import { COLORS } from "@/lib/palette";

interface ShareCardV2Labels {
  privacyScore: string;
  topLeak: string;
  scannedClientSide: string;
  tx: string;
  address: string;
}

const defaultV2Labels: ShareCardV2Labels = {
  privacyScore: "PRIVACY SCORE",
  topLeak: "TOP LEAK",
  scannedClientSide: "SCANNED CLIENT-SIDE",
  tx: "TX",
  address: "ADDRESS",
};

export interface ShareCardOptions {
  grade: Grade;
  score: number;
  query: string;
  inputType: "txid" | "address";
  /** Transaction type label (e.g. "Whirlpool CoinJoin"). */
  txType?: string | null;
  /** Title of the most negative-impact finding, chosen by the caller. */
  topLeak?: string | null;
  /** Label overrides. */
  v2Labels?: Partial<ShareCardV2Labels>;
}

/** Short form of a txid/address for the card: first 8 and last 8 characters. */
export function shortQuery(query: string): string {
  return query.length > 20 ? `${query.slice(0, 8)}\u2026${query.slice(-8)}` : query;
}

/** Everything the card prints, resolved from the options (pure, testable). */
export function buildV2CardModel(options: ShareCardOptions) {
  const labels = { ...defaultV2Labels, ...options.v2Labels };
  const score = Math.max(0, Math.min(100, Math.round(options.score)));
  return {
    grade: options.grade,
    gradeColor: GRADE_HEX[options.grade] ?? COLORS.foreground,
    score: `${score}`,
    scoreFraction: score / 100,
    txType: options.txType?.trim() || null,
    topLeak: options.topLeak?.trim() || null,
    idLine: `${options.inputType === "txid" ? labels.tx : labels.address}  ${shortQuery(options.query)}`,
    labels,
  };
}

const V2 = {
  bg: "#0b0b0d",
  fg: "#f2f2f4",
  muted: "#a6a6b0",
  faint: "#70707b",
  hairline: "rgba(255, 255, 255, 0.09)",
  surface: "#111114",
  sans: "system-ui, -apple-system, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;

/** Cut text with an ellipsis so it fits maxWidth at the current font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}\u2026`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}\u2026`;
}

function drawV2Card(ctx: CanvasRenderingContext2D, options: ShareCardOptions): void {
  const m = buildV2CardModel(options);
  const L = 80;
  const R = 1120;

  ctx.fillStyle = V2.bg;
  ctx.fillRect(0, 0, 1200, 630);

  // Wordmark + provenance
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 30px ${V2.sans}`;
  ctx.fillStyle = V2.fg;
  ctx.fillText("am-i.", L, 92);
  ctx.fillStyle = COLORS.bitcoin;
  ctx.fillText("exposed", L + ctx.measureText("am-i.").width, 92);
  ctx.font = `14px ${V2.mono}`;
  ctx.fillStyle = V2.faint;
  ctx.textAlign = "right";
  ctx.fillText(m.labels.scannedClientSide, R, 90);
  ctx.textAlign = "left";

  // Grade letter
  ctx.font = `700 200px ${V2.sans}`;
  ctx.fillStyle = m.gradeColor;
  ctx.fillText(m.grade, L - 8, 330);
  const colX = L + Math.max(ctx.measureText(m.grade).width, 150) + 48;

  // Score column
  ctx.font = `13px ${V2.mono}`;
  ctx.fillStyle = V2.faint;
  ctx.fillText(m.labels.privacyScore, colX, 186);
  ctx.font = `600 64px ${V2.mono}`;
  ctx.fillStyle = V2.fg;
  ctx.fillText(m.score, colX, 256);
  const scoreW = ctx.measureText(m.score).width;
  ctx.font = `28px ${V2.mono}`;
  ctx.fillStyle = V2.faint;
  ctx.fillText("/100", colX + scoreW + 6, 256);
  // Score track: hairline with the grade-colored share
  const trackW = R - colX;
  ctx.fillStyle = V2.hairline;
  ctx.fillRect(colX, 280, trackW, 2);
  ctx.fillStyle = m.gradeColor;
  ctx.fillRect(colX, 280, trackW * m.scoreFraction, 2);
  if (m.txType) {
    ctx.font = `24px ${V2.sans}`;
    ctx.fillStyle = V2.muted;
    ctx.fillText(fitText(ctx, m.txType, trackW), colX, 326);
  }

  // Evidence tag: the single top leak
  if (m.topLeak) {
    const y = 382;
    const h = 96;
    ctx.fillStyle = V2.surface;
    ctx.strokeStyle = V2.hairline;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(L + 0.5, y + 0.5, R - L - 1, h - 1, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = m.gradeColor;
    ctx.beginPath();
    ctx.roundRect(L + 20, y + 22, 3, h - 44, 2);
    ctx.fill();
    ctx.font = `13px ${V2.mono}`;
    ctx.fillStyle = V2.faint;
    ctx.fillText(m.labels.topLeak, L + 44, y + 38);
    ctx.font = `500 26px ${V2.sans}`;
    ctx.fillStyle = V2.fg;
    ctx.fillText(fitText(ctx, m.topLeak, R - L - 72), L + 44, y + 74);
  }

  // Footer: id + site
  ctx.fillStyle = V2.hairline;
  ctx.fillRect(L, 530, R - L, 1);
  ctx.font = `18px ${V2.mono}`;
  ctx.fillStyle = V2.muted;
  ctx.fillText(m.idLine, L, 576);
  ctx.font = `18px ${V2.sans}`;
  ctx.fillStyle = V2.faint;
  ctx.textAlign = "right";
  ctx.fillText("am-i.exposed", R, 576);
  ctx.textAlign = "left";
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to generate share card image"));
    }, "image/png");
  });
}

/** Draws the share card (grade, score, type, top leak) as a 1200x630 PNG. */
export async function generateShareCard(options: ShareCardOptions): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context not available");
  drawV2Card(ctx, options);
  return canvasToPng(canvas);
}

/** Hand a PNG to the Web Share sheet (mobile) or fall back to a download. */
export async function sharePng(blob: Blob, filename: string): Promise<void> {
  if (navigator.share && navigator.canShare) {
    const shareData = { files: [new File([blob], filename, { type: "image/png" })] };
    if (navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
