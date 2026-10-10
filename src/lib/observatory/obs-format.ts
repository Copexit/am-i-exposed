/** BTC amount for the Observatory: 2 decimals from 1 BTC up, 4 below, "0" for zero. No unit. */
export function fmtBtc(btc: number, locale: string): string {
  if (btc === 0) return (0).toLocaleString(locale);
  const digits = Math.abs(btc) >= 1 ? 2 : 4;
  return btc.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Integer count with locale grouping. */
export const fmtCount = (n: number, locale: string): string => Math.round(n).toLocaleString(locale);

/** `url` if it is an absolute http(s) URL, else null: upstream links never become `javascript:` or relative hrefs. */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * The upstream fee string ("0.3% + Free remixing + Free under 0.03 BTC") is free text joined by " + ".
 * Known phrases are translated; the rate and any unknown part pass through unchanged.
 */
export function localizeFees(fees: string, t: (key: string, o: { defaultValue: string; amount?: string }) => string): string {
  return fees
    .split(" + ")
    .map((part) => {
      if (part === "Free remixing") return t("observatory.wabisabi.fees.freeRemixing", { defaultValue: part });
      const m = /^Free under (.+)$/.exec(part);
      return m ? t("observatory.wabisabi.fees.freeUnder", { defaultValue: part, amount: m[1] }) : part;
    })
    .join(" + ");
}
