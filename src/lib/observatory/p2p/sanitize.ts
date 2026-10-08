/**
 * Free-text labels from P2P venues can carry contact details. Everything shown
 * goes through here: URLs, handles, phone-like digit runs, redaction
 * placeholders and emoji are removed.
 */
const STRIP: RegExp[] = [
  /https?:\/\/\S+/gi,
  /\b(?:t|wa)\.me\/\S+/gi,
  /\[(?:link|number)\]/gi,
  /@\w+/g,
  /\+?\d[\d\s-]{5,}\d/g,
  /[\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}]/gu,
];

function clean(s: string, max: number): string {
  let out = s;
  for (const re of STRIP) out = out.replace(re, " ");
  out = out.replace(/\s+/g, " ").trim().replace(/^[\s\-,.;:|/*_~\u00B7\u2022]+|[\s\-,.;:|/*_~\u00B7\u2022]+$/g, "").trim();
  return out.length > max ? `${out.slice(0, max - 1).trimEnd()}…` : out;
}

/** Contact details stripped, untruncated: input for payment-method matching. */
export const cleanLabel = (s: string): string => clean(s, Infinity);

/** Default max 4 labels, 32 chars each; deduped case-insensitively. */
export function sanitizeMethods(raw: string[], max = 4, maxChars = 32): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string") continue;
    const c = clean(r, maxChars);
    const k = c.toLowerCase();
    if (!c || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? " ";
  });
}

/** Default 140 chars; empty -> null. */
export function sanitizeNotice(s: string, max = 140): string | null {
  if (typeof s !== "string") return null;
  // Coordinators write notices in HTML: keep the text only.
  // Entities decode to text only: the result is rendered as a React text node, never as HTML.
  return clean(decodeEntities(s.replace(/<[^>]*>/g, " ")), max) || null;
}
