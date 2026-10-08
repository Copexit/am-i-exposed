"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { AMT_MAX, AMT_MIN, amtInRange } from "@/lib/observatory/obs-hash";
import { fmtFiat, parseAmount } from "@/lib/observatory/p2p/p2p-format";
import { CHIP, CHIP_OFF, CHIP_ON } from "./p2p-ui";

export type AmountUnit = "fiat" | "btc";
export interface AmountPatch { amt: number | null; amtu?: AmountUnit }

const DEBOUNCE_MS = 400;

/** A BTC amount with up to 4 significant digits: "0.003333", "1.25". */
export const fmtBtcAmount = (btc: number, locale: string): string => btc.toLocaleString(locale, { maximumSignificantDigits: 4 });

/** Narrow symbol for a currency ("€"), else its code. */
function symbol(cur: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: cur, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency")?.value ?? cur;
  } catch {
    return cur;
  }
}

/** The amount input, so a clear from the note can return focus to it. */
export const AMOUNT_INPUT_ID = "p2p-amount-input";
export const focusAmountInput = () => document.getElementById(AMOUNT_INPUT_ID)?.focus();

const valid = amtInRange;
const toText = (n: number | null, unit: AmountUnit, locale: string) =>
  n === null ? "" : n.toLocaleString(locale, { maximumFractionDigits: unit === "btc" ? 8 : 2, useGrouping: false });

interface Props {
  cur: string | null;
  /** Index price of `cur` (fiat per BTC); null disables BTC entry. */
  idx: number | null;
  amt: number | null;
  unit: AmountUnit;
  onChange: (patch: AmountPatch) => void;
}

/** The amount to trade, in the market currency or in BTC; typing writes the hash after a pause. */
export function AmountFilter({ cur, idx, amt, unit, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const [text, setText] = useState(() => toText(amt, unit, locale));
  const input = useRef<HTMLInputElement>(null);
  const descId = useId();
  const noIdxId = useId();
  const parsed = parseAmount(text, locale);
  const typed = valid(parsed, unit);

  // Outside changes (clear, Back) rewrite the field; the user's own typing does not. A currency
  // switch with a fiat unit drops the text too, so a pending commit never lands in the new market.
  const [seen, setSeen] = useState({ amt, unit, cur });
  if (seen.amt !== amt || seen.unit !== unit || seen.cur !== cur) {
    setSeen({ amt, unit, cur });
    if (valid(parseAmount(text, locale), unit) !== amt || (seen.cur !== cur && unit === "fiat")) setText(toText(amt, unit, locale));
  }

  useEffect(() => {
    if (typed === amt) return;
    const id = setTimeout(() => onChange({ amt: typed }), DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [typed, amt, onChange]);

  const fiatCode = cur ?? "";
  const sym = unit === "btc" ? "₿" : symbol(fiatCode, locale);
  const unitLabel = unit === "btc" ? "BTC" : fiatCode;
  const switchUnit = (next: AmountUnit) => {
    if (next === unit) return;
    const v = typed === null || idx === null ? null : next === "btc" ? Math.round((typed / idx) * 1e8) / 1e8 : Math.round(typed * idx * 100) / 100;
    setText(toText(v, next, locale));
    onChange({ amt: valid(v, next), amtu: next });
  };
  const clear = () => { setText(""); onChange({ amt: null }); input.current?.focus(); };

  const tolerance = t("observatory.p2p.amount.tolerance", { defaultValue: "Offers match when the amount is inside their limits. Fixed-amount offers match within ±5%. Offers with no stated limits stay in the list. A BTC amount is priced at each offer's own price when it has one, else at the index, so it is an estimate." });
  const noIndex = t("observatory.p2p.amount.noIndexBtc", { defaultValue: "No index price for {{cur}}: a BTC amount cannot be converted.", cur: fiatCode });
  const bad = text.trim() === "" || typed !== null
    ? null
    : parsed === null
      ? t("observatory.p2p.amount.invalid", { defaultValue: "Enter a positive number." })
      : t("observatory.p2p.amount.range", {
        defaultValue: "Enter an amount between {{min}} and {{max}}.",
        min: unit === "btc" ? `${AMT_MIN.btc.toFixed(8)} BTC` : AMT_MIN.fiat.toLocaleString(locale),
        max: unit === "btc" ? `${AMT_MAX.btc.toLocaleString(locale)} BTC` : AMT_MAX.fiat.toLocaleString(locale),
      });
  const converted = typed === null || idx === null
    ? null
    : unit === "fiat" ? `${fmtBtcAmount(typed / idx, locale)} BTC` : fmtFiat(typed * idx, fiatCode, locale);

  return (
    <div className="w-full sm:w-56">
      <div className="flex items-center gap-1">
        {fiatCode !== "BTC" && <div role="group" aria-label={t("observatory.p2p.amount.unit", { defaultValue: "Amount unit" })} className="grid shrink-0 grid-cols-2 gap-0.5 rounded-lg border border-card-border bg-surface-inset p-0.5">
          {(["fiat", "btc"] as const).map((u) => {
            const off = u === "btc" && idx === null && unit !== "btc";
            return (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                aria-disabled={off || undefined}
                aria-describedby={off ? noIdxId : undefined}
                title={off ? noIndex : undefined}
                onClick={() => { if (!off) switchUnit(u); }}
                className={`${CHIP} min-h-9 justify-center px-2 text-xs num aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${unit === u ? CHIP_ON : CHIP_OFF}`}
              >
                {u === "btc" ? "BTC" : fiatCode}
              </button>
            );
          })}
          {idx === null && <span id={noIdxId} className="sr-only">{noIndex}</span>}
        </div>}
        <div className="relative min-w-0 flex-1">
          <span aria-hidden="true" className="num pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-faint">
            {sym}
          </span>
          <input
            ref={input}
            id={AMOUNT_INPUT_ID}
            aria-label={t("observatory.p2p.amount.label", { defaultValue: "Amount in {{unit}}", unit: unitLabel })}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            data-testid="p2p-amount"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape" && text) { e.stopPropagation(); clear(); } }}
            placeholder={t("observatory.p2p.amount.placeholder", { defaultValue: "Amount" })}
            title={tolerance}
            aria-describedby={descId}
            aria-invalid={bad !== null || undefined}
            className={`num h-10 w-full rounded-lg border bg-surface-inset ${sym.length > 2 ? "pl-14" : "pl-8"} text-sm text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin ${text ? "pr-10" : "pr-3"} ${bad !== null ? "border-severity-high/60" : "border-hairline"}`}
          />
          {text && (
            <button
              type="button"
              onClick={clear}
              aria-label={t("observatory.p2p.amount.clear", { defaultValue: "Clear amount filter" })}
              className="absolute right-0.5 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-faint hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <p id={descId} data-testid="p2p-amount-converted" className="num mt-1 flex min-h-4 items-center gap-1 px-1 text-xs text-faint">
        {converted !== null && <span>{`≈ ${converted}`}</span>}
        {converted === null && unit === "btc" && idx === null && (
          <span>{noIndex}</span>
        )}
        {bad !== null && <span className="text-severity-high">{bad}</span>}
        <span title={tolerance} className="ml-auto inline-flex shrink-0 items-center">
          <Info size={12} aria-hidden="true" />
          <span className="sr-only">{tolerance}</span>
        </span>
      </p>
    </div>
  );
}
