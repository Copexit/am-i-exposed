"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote, ChevronDown, Coins, CreditCard, Ellipsis, Gift, Landmark, Wallet, X, Zap, type LucideIcon } from "lucide-react";
import type { Market } from "@/lib/observatory/p2p/types";
import { pmCategory, pmName, type PmCategory } from "@/lib/observatory/p2p/payment-methods";
import { fmtPremium, fmtSatsBtc } from "@/lib/observatory/p2p/p2p-format";
import { fmtCount } from "@/lib/observatory/obs-format";
import { makerSide } from "@/lib/observatory/p2p/market";
import { CHIP, CHIP_OFF } from "./p2p-ui";

const GLYPH: Record<PmCategory, LucideIcon> = {
  instant: Zap, bank: Landmark, wallet: Wallet, cash: Banknote, gift: Gift, crypto: Coins, other: Ellipsis,
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Brand names stay as they are; generic catalog names ("Bank transfer", "Other") are translated. */
export function usePmLabel(): (id: string) => string {
  const { t } = useTranslation();
  return (id) => t(`observatory.p2p.pm.names.${id}`, { defaultValue: pmName(id) });
}

interface Props {
  /** Methods in the current currency and side, with offer counts (methodCounts order). */
  methods: { id: string; count: number }[];
  /** Offers in the current currency and side, before the method filter. */
  total: number;
  pm: string | null;
  onChange: (pm: string | null) => void;
}

/** A disclosure with a search field and one toggle per payment method; Escape or a click outside closes it. */
export function PaymentMethodPicker({ methods, total, pm, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const label = usePmLabel();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  const close = () => { setOpen(false); setQ(""); trigger.current?.focus(); };
  const pick = (id: string | null) => { onChange(id); close(); };

  // The selected method stays listed even when the current market has none of it.
  const list = pm && !methods.some((m) => m.id === pm) ? [{ id: pm, count: 0 }, ...methods] : methods;
  const needle = fold(q.trim());
  const shown = needle ? list.filter((m) => fold(label(m.id)).includes(needle) || m.id.includes(needle)) : list;

  const row = (id: string | null, name: string, count: number) => {
    const Icon = id ? GLYPH[pmCategory(id)] : CreditCard;
    const on = pm === id;
    return (
      <li key={id ?? "any"}>
        <button
          type="button"
          aria-pressed={on}
          onClick={() => pick(id)}
          className={`flex w-full min-h-10 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin ${on ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2/60 hover:text-foreground"}`}
        >
          <Icon size={14} aria-hidden="true" className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <span className="num text-xs text-faint">{fmtCount(count, locale)}</span>
        </button>
      </li>
    );
  };

  return (
    <div
      ref={root}
      className="relative w-full sm:w-auto"
      onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}
    >
      <div className="flex items-center gap-1">
        <button
          ref={trigger}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          data-testid="p2p-pm-trigger"
          onClick={() => (open ? close() : setOpen(true))}
          className={`${CHIP} min-w-0 flex-1 justify-between border sm:flex-none ${pm ? "border-hairline-strong bg-surface-2 text-foreground" : `border-hairline ${CHIP_OFF}`}`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <CreditCard size={14} aria-hidden="true" className="shrink-0 text-faint" />
            <span className="sr-only">{t("observatory.p2p.pm.label", { defaultValue: "Payment method" })}: </span>
            <span className="truncate">{pm ? label(pm) : t("observatory.p2p.pm.any", { defaultValue: "Any payment method" })}</span>
          </span>
          <ChevronDown size={14} aria-hidden="true" className={`shrink-0 text-faint transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {pm && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={t("observatory.p2p.pm.clear", { defaultValue: "Clear payment method filter" })}
            className={`${CHIP} justify-center border border-hairline px-2.5 ${CHIP_OFF}`}
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={t("observatory.p2p.pm.label", { defaultValue: "Payment method" })}
          className="absolute left-0 right-0 top-full z-30 mt-1 rounded-xl border border-card-border bg-surface-elevated p-2 shadow-lg sm:left-auto sm:w-80"
        >
          <input
            type="search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t("observatory.p2p.pm.search", { defaultValue: "Search payment methods" })}
            placeholder={t("observatory.p2p.pm.search", { defaultValue: "Search payment methods" })}
            className="mb-2 h-10 w-full rounded-lg border border-hairline bg-surface-inset px-3 text-sm text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin"
          />
          <ul className="max-h-72 space-y-0.5 overflow-y-auto overscroll-contain">
            {!needle && row(null, t("observatory.p2p.pm.any", { defaultValue: "Any payment method" }), total)}
            {shown.map((m) => row(m.id, label(m.id), m.count))}
            {shown.length === 0 && (
              <li className="px-2.5 py-3 text-sm text-faint">{t("observatory.p2p.pm.noMatch", { defaultValue: "No payment method matches." })}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** States what the method filter narrows, with the filtered market's stats. */
export function PmFilterNote({ market, side, pm, onClear }: { market: Market | null; side: "buy" | "sell"; pm: string; onClear: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const label = usePmLabel();
  const count = market?.offers.filter((o) => o.side === makerSide(side)).length ?? 0;
  const median = market?.medianPremium[side] ?? null;
  return (
    <div data-testid="p2p-pm-note" role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-surface-inset px-3 py-2 text-sm text-muted">
      <p className="min-w-0">
        {t("observatory.p2p.pm.note", {
          defaultValue: "Filtered to offers that accept {{method}}: {{count}} offers, {{btc}} BTC.",
          method: label(pm),
          count,
          btc: fmtSatsBtc(market?.liquiditySats[side] ?? 0, locale),
        })}
        {median !== null && ` ${t("observatory.p2p.pm.median", { defaultValue: "Median premium {{premium}}.", premium: fmtPremium(median, locale) })}`}
      </p>
      <button type="button" onClick={onClear} className="min-h-10 shrink-0 rounded-lg px-2 text-sm text-foreground underline-offset-2 hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin">
        {t("observatory.p2p.pm.showAll", { defaultValue: "Show all methods" })}
      </button>
    </div>
  );
}
