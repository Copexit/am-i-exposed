"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  adviseCoinSelection,
  type CoinSelectionAdvice,
  type CoinSelectionInput,
  type CoinSelectionPlan,
  type OriginHint,
} from "@/lib/analysis/coin-selection";
import { fmtN } from "@/lib/format";
import { SEVERITY_STYLES } from "@/components/findingCardConstants";

const FIELD = "w-full h-10 bg-surface-inset border border-card-border rounded-lg px-3 text-sm text-foreground num placeholder:text-faint focus:border-bitcoin/50 focus-visible:outline-none transition-colors";

export function CoinSelector({ utxos }: { utxos: CoinSelectionInput[] }) {
  const { t } = useTranslation();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState("5");
  const [advice, setAdvice] = useState<CoinSelectionAdvice | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountSats = parseInt(amount, 10);
    const rate = parseFloat(feeRate);
    if (isNaN(amountSats) || amountSats <= 0 || isNaN(rate) || rate <= 0) return;
    setAdvice(adviseCoinSelection(utxos, amountSats, rate));
  }

  return (
    <div className="space-y-5" data-testid="coin-selector">
      {/* Inputs and button share one grid row aligned to the end, so a wrapped label never shifts them. */}
      <form onSubmit={handleSubmit} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,11rem)_auto] items-end gap-3">
        <div className="min-w-0">
          <label htmlFor={`${id}-amount`} className="block text-[13px] text-muted mb-1.5">
            {t("wallet.coinSel.amount", { defaultValue: "Amount (sats)" })}
          </label>
          <input id={`${id}-amount`} type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)} placeholder="50000" min="1" className={FIELD} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-fee`} className="block text-[13px] text-muted mb-1.5">
            {t("wallet.coinSel.feeRate", { defaultValue: "Fee (sat/vB)" })}
          </label>
          <input id={`${id}-fee`} type="number" inputMode="decimal" value={feeRate} onChange={e => setFeeRate(e.target.value)} placeholder="5" min="1" step="0.1" className={FIELD} />
        </div>
        <button
          type="submit"
          className="col-span-2 sm:col-span-1 h-10 px-4 bg-bitcoin text-black font-semibold text-sm rounded-lg hover:bg-bitcoin-hover transition-colors cursor-pointer whitespace-nowrap"
        >
          {t("wallet.suggest", { defaultValue: "Suggest selection" })}
        </button>
      </form>

      {advice?.kind === "insufficient" && (
        <p role="status" className="rounded-lg border border-severity-high/25 bg-severity-high/5 px-4 py-3 text-sm text-foreground">
          {t("wallet.coinSel.insufficient", {
            spendable: fmtN(advice.spendable),
            shortfall: fmtN(advice.shortfall),
            defaultValue: "Not enough funds. The spendable balance is {{spendable}} sats, {{shortfall}} sats short of the amount plus fee.",
          })}
        </p>
      )}

      {advice?.kind === "plans" && (
        <div className="space-y-3" role="status">
          {advice.plans.map((plan, i) => (
            <PlanCard key={plan.strategy} plan={plan} recommended={i === 0 && advice.plans.length > 1} />
          ))}
          {advice.stonewall !== null && (
            <div className="rounded-lg border border-dashed border-hairline-strong px-4 py-3 text-sm space-y-2">
              <span className="eyebrow block">{t("wallet.coinSel.stonewallTitle", { defaultValue: "Advanced: Stonewall" })}</span>
              <p className="text-muted leading-relaxed">
                {t("wallet.coinSel.stonewall", { defaultValue: "A Stonewall transaction looks like a small CoinJoin: the payment hides among two equal outputs. It needs coins for about twice the amount, split into two groups, and few wallets support it (for example Ashigaru)." })}
                {!advice.stonewall && <> {t("wallet.coinSel.stonewallShort", { defaultValue: "This wallet does not hold enough for one right now." })}</>}
              </p>
            </div>
          )}
        </div>
      )}

      {advice && advice.dustExcluded > 0 && (
        <p className="text-[13px] text-muted">
          {t("wallet.coinSel.dustExcluded", { count: advice.dustExcluded, defaultValue: "Dust coins left out: {{count}}. They may come from a dust attack, and spending them links them to the rest of the wallet." })}
        </p>
      )}
    </div>
  );
}

function PlanCard({ plan, recommended }: { plan: CoinSelectionPlan; recommended: boolean }) {
  const { t } = useTranslation();
  const note = plan.strategy === "single-coin" ? "single" : plan.origins === 1 ? "linked" : "merge";
  const stats = [
    { label: t("wallet.coinSel.inputs", { defaultValue: "Inputs" }), value: fmtN(plan.selected.length) },
    { label: t("wallet.coinSel.fee", { defaultValue: "Fee" }), value: `${fmtN(plan.fee)} sats` },
    { label: t("wallet.coinSel.change", { defaultValue: "Change" }), value: plan.change > 0 ? `${fmtN(plan.change)} sats` : t("wallet.coinSel.noChange", { defaultValue: "No change" }) },
    { label: t("wallet.coinSel.origins", { defaultValue: "Origins" }), value: fmtN(plan.origins) },
  ];

  return (
    <section data-testid={`coin-plan-${plan.strategy}`} className="rounded-lg border border-hairline bg-surface-2/40 p-4 space-y-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-[15px] font-medium text-foreground">{t(`wallet.coinSel.strategy.${plan.strategy}`)}</h3>
          {recommended && (
            <span className="text-[11px] leading-none rounded px-1.5 py-1 bg-severity-good/10 text-severity-good">
              {t("wallet.coinSel.recommended", { defaultValue: "Recommended" })}
            </span>
          )}
        </div>
        <p className="text-sm text-muted leading-relaxed">{t(`wallet.coinSel.note.${note}`)}</p>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 max-w-2xl">
        {stats.map(s => (
          <div key={s.label} className="min-w-0">
            <dt className="text-[13px] text-muted">{s.label}</dt>
            <dd className="num text-[15px] text-foreground mt-0.5">{s.value}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <span className="eyebrow block">{t("wallet.coinSel.coins", { defaultValue: "Coins to spend" })}</span>
        <ol className="rounded-lg border border-hairline divide-y divide-hairline">
          {plan.selected.map((c, i) => (
            <li key={`${c.utxo.txid}:${c.utxo.vout}`} className="flex items-start gap-3 px-3 py-2.5">
              <span className="num text-[13px] text-faint w-6 shrink-0">#{i + 1}</span>
              <div className="flex-1 min-w-0 space-y-1.5">
                <span className="num text-[13px] text-foreground block truncate" title={`${c.utxo.txid}:${c.utxo.vout}`}>
                  {c.utxo.txid.slice(0, 8)}...{c.utxo.txid.slice(-4)}:{c.utxo.vout}
                </span>
                {c.hints.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.hints.map(h => <HintChip key={h.kind} hint={h} />)}
                  </div>
                )}
              </div>
              <span className="num text-[13px] text-foreground text-right shrink-0">{fmtN(c.utxo.value)} sats</span>
            </li>
          ))}
        </ol>
      </div>

      {plan.warnings.length > 0 && (
        <ul className="space-y-1.5">
          {plan.warnings.map(w => (
            <li key={w.id} className="flex items-start gap-2.5 text-sm text-foreground">
              <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_STYLES[w.severity].dot}`} aria-hidden="true" />
              <span>{t(`wallet.coinSel.warn.${w.id}`, { count: w.count, amount: fmtN(w.count) })}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HintChip({ hint }: { hint: OriginHint }) {
  const { t } = useTranslation();
  const tone =
    hint.kind === "coinjoin" ? "text-severity-good border-severity-good/30"
    : hint.kind === "reused-address" ? "text-severity-high border-severity-high/30"
    : "text-muted border-hairline-strong";
  return (
    <span className={`text-[11px] leading-none whitespace-nowrap border rounded px-1.5 py-1 ${tone}`}>
      {t(`wallet.coinSel.hint.${hint.kind}`, { n: "with" in hint ? hint.with : 0 })}
    </span>
  );
}
