"use client";

import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { absorbedIf, evaluateSelection, outpointOf, planLinks } from "@/lib/analysis/coin-selection";
import { fmtN } from "@/lib/format";
import { FIELD, parseInputs, PlanRules, PlanWarnings } from "./CoinSelector";
import { parseMaxAbsorb, type CoinControl } from "./useCoinControl";
import { LabelTagChip } from "./WalletLabels";
import { LABEL_TAGS } from "@/lib/wallet/labels";

/**
 * Sticky summary of the coins ticked in the UTXO list: count and total, and at
 * the selector's amount and fee rate (editable here too) the fee, change, new
 * links, label rules and warnings, from the advisor's own plan building.
 */
export function CoinControlBar({ control: c, onCompare }: { control: CoinControl; onCompare: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const sats = t("common.sats", { defaultValue: "sats" });
  const picked = useMemo(() => c.utxos.filter(u => c.selected.has(outpointOf(u))), [c.utxos, c.selected]);
  const total = picked.reduce((s, u) => s + u.utxo.value, 0);
  // Origin tags among the selected coins, in the convention's order
  const tags = LABEL_TAGS.filter(tag => picked.some(u => u.labelTags?.includes(tag)));
  const input = parseInputs(c.amount, c.feeRate);
  const maxAbsorb = parseMaxAbsorb(c.maxAbsorb);
  const plain = useMemo(
    () => evaluateSelection(c.utxos, c.selected, input.amount, input.feeRate, { maxAbsorb }),
    [c.utxos, c.selected, input.amount, input.feeRate, maxAbsorb],
  );
  // Small change: offer to pay it to miners instead (the advisor's no-change variant).
  const absorbable = plain.kind === "plan" && plain.plan.change > 0 && absorbedIf(plain.plan.change, input.feeRate) <= maxAbsorb ? plain.plan.change : 0;
  const result = useMemo(
    () => (absorbable && c.absorb ? evaluateSelection(c.utxos, c.selected, input.amount, input.feeRate, { maxAbsorb, absorb: true }) : plain),
    [absorbable, c.absorb, c.utxos, c.selected, input.amount, input.feeRate, maxAbsorb, plain],
  );
  if (c.selected.size === 0) return null;

  const plan = result.kind === "plan" ? result.plan : null;
  const links = plan && planLinks(plan);
  const stats = plan && links && [
    { label: t("wallet.coinSel.fee", { defaultValue: "Fee" }), value: `${fmtN(plan.fee)} ${sats}` },
    { label: t("wallet.coinSel.change", { defaultValue: "Change" }), value: plan.change > 0 ? `${fmtN(plan.change)} ${sats}` : t("wallet.coinSel.noChange", { defaultValue: "No change" }) },
    {
      label: t("wallet.coinControl.links", { defaultValue: "New links" }),
      value: [
        links.certain > 0 && fmtN(links.certain),
        links.inferred > 0 && t("wallet.coinControl.linksProbable", { count: links.inferred, n: fmtN(links.inferred), defaultValue: "{{n}} probable" }),
      ].filter(Boolean).join(" + ") || t("wallet.coinControl.linksNone", { defaultValue: "None" }),
    },
  ];

  return (
    <section
      data-testid="coin-control-bar"
      aria-label={t("wallet.coinControl.title", { defaultValue: "Selected coins" })}
      className="sticky bottom-0 z-10 -mx-3 sm:mx-0 rounded-t-xl sm:rounded-xl border border-bitcoin/30 bg-surface-1 shadow-(--shadow-card) px-3 sm:px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto"
    >
      <div className="flex items-center gap-x-3 gap-y-1 flex-wrap">
        <p role="status" className="text-[14px] font-medium text-foreground mr-auto">
          {t("wallet.coinControl.selected", { count: c.selected.size, n: fmtN(c.selected.size), defaultValue: "{{n}} coins selected" })}
          <span className="num text-muted font-normal"> · {fmtN(total)} {sats}</span>
        </p>
        {tags.length > 0 && (
          <span data-testid="coin-control-tags" className="flex flex-wrap gap-1.5 order-last basis-full sm:order-none sm:basis-auto">
            {tags.map(tag => <LabelTagChip key={tag} tag={tag} />)}
          </span>
        )}
        <button type="button" onClick={c.clear} className="text-[13px] text-muted hover:text-foreground min-h-10 px-1 cursor-pointer">
          {t("wallet.coinControl.clear", { defaultValue: "Clear" })}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,8rem)_minmax(0,1fr)] items-end gap-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-amount`} className="block text-[13px] text-muted mb-1.5">{t("wallet.coinSel.amount", { defaultValue: "Amount (sats)" })}</label>
          <input id={`${id}-amount`} type="number" inputMode="numeric" value={c.amount} onChange={e => c.setAmount(e.target.value)} placeholder="50000" min="1" className={FIELD} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-fee`} className="block text-[13px] text-muted mb-1.5">{t("wallet.coinSel.feeRate", { defaultValue: "Fee (sat/vB)" })}</label>
          <input id={`${id}-fee`} type="number" inputMode="decimal" value={c.feeRate} onChange={e => c.setFeeRate(e.target.value)} placeholder="5" min="0.1" step="any" className={FIELD} />
        </div>
        <button
          type="button"
          onClick={() => { c.compare(); onCompare(); }}
          disabled={!plan}
          className="col-span-2 sm:col-span-1 sm:justify-self-end h-10 px-4 rounded-lg border border-bitcoin/50 text-bitcoin text-sm font-medium hover:bg-bitcoin/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {t("wallet.coinControl.compare", { defaultValue: "Compare with suggestions" })}
        </button>
      </div>

      {result.kind === "invalid" && (
        <p className="text-[13px] text-muted">{t("wallet.coinControl.needAmount", { defaultValue: "Enter the amount to pay to see the fee, change and warnings for these coins." })}</p>
      )}
      {result.kind === "insufficient" && (
        <p className="text-[13px] text-severity-high">
          {t("wallet.coinControl.short", { amount: fmtN(result.shortfall), defaultValue: "{{amount}} sats short of the amount plus fee." })}
        </p>
      )}
      {stats && plan && (
        <>
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 max-w-xl">
            {stats.map(s => (
              <div key={s.label} className="min-w-0">
                <dt className="text-[12px] text-muted">{s.label}</dt>
                <dd className="num text-[14px] text-foreground mt-0.5">{s.value}</dd>
              </div>
            ))}
          </dl>
          {absorbable > 0 && (
            <label className="flex items-center gap-2 min-h-10 text-[13px] text-foreground cursor-pointer w-fit">
              <input type="checkbox" checked={c.absorb} onChange={e => c.setAbsorb(e.target.checked)} className="size-4 accent-bitcoin" />
              {t("wallet.coinControl.absorb", { amount: fmtN(absorbable), defaultValue: "Pay the {{amount}} sats of change to miners (no change)" })}
            </label>
          )}
          <PlanRules plan={plan} />
          <PlanWarnings plan={plan} />
        </>
      )}
    </section>
  );
}
