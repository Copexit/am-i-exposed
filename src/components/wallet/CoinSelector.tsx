"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  adviseCoinSelection,
  evaluateSelection,
  outpointOf,
  rankPlans,
  PLAN_CRITERIA,
  type CoinSelectionAdvice,
  type CoinSelectionInput,
  type CoinSelectionPlan,
  type PlanWarningId,
} from "@/lib/analysis/coin-selection";
import {
  recipientHistory, roundChange, spendingAlerts, validRecipient, walletAddressType,
  type RecipientHistory, type SpendAlert,
} from "@/lib/analysis/spending-advice";
import type { WalletAddressInfo } from "@/lib/analysis/wallet-audit";
import { createMempoolClient } from "@/lib/api/mempool";
import { useNetwork } from "@/context/NetworkContext";
import type { Severity } from "@/lib/types";
import { fmtN } from "@/lib/format";
import { SEVERITY_STYLES } from "@/components/findingCardConstants";
import { HintChip } from "./HintChip";
import { LabelTagChip, LabelText } from "./WalletLabels";
import { parseMaxAbsorb, useCoinControl, type CoinControl } from "./useCoinControl";
import { AlertTriangle, Check, X } from "lucide-react";

export const FIELD = "w-full h-10 bg-surface-inset border border-card-border rounded-lg px-3 text-sm text-foreground num placeholder:text-faint focus:border-bitcoin/50 focus-visible:outline-none transition-colors";

/** One plan's identity: its coins, and whether its change goes to miners. */
const planKey = (p: CoinSelectionPlan) => p.selected.map(outpointOf).sort().join() + (p.absorbsChange ? "+absorb" : "");

/** Plans shown before "Show all". */
const COLLAPSED_PLANS = 3;

/** Amount and fee rate as typed; empty fields become NaN (not 0) so they read as invalid. */
export const parseInputs = (amount: string, feeRate: string) =>
  ({ amount: amount.trim() ? Number(amount) : NaN, feeRate: feeRate.trim() ? Number(feeRate) : NaN });

/** Where the reuse check sends the address: the API's host (a relative API URL is this site's own). */
const apiHost = (base: string) => { try { return new URL(base, window.location.origin).host; } catch { return base; } };

interface Submitted {
  amount: number;
  feeRate: number;
  maxAbsorb: number;
  /** Valid recipient address, or null */
  recipient: string | null;
  /** What the wallet's history says about the recipient (local) */
  history: RecipientHistory | null;
}

export function CoinSelector({ utxos, control, history }: {
  utxos: CoinSelectionInput[];
  /** Shared with the UTXO list (manual selection, criterion, URL); a selector on its own keeps its own */
  control?: CoinControl;
  /** The wallet's scan: checked locally for the recipient address (rule 1, rule 6) */
  history?: readonly WalletAddressInfo[];
}) {
  const { t } = useTranslation();
  const id = useId();
  const own = useCoinControl(null, utxos);
  const c = control ?? own;
  const { network, config, apiReady } = useNetwork();
  const [advice, setAdvice] = useState<CoinSelectionAdvice | null>(null);
  /** Inputs of the last submit: the frozen toggle re-runs with these, not with unsubmitted edits */
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const recipient = c.recipient.trim();
  const recipientOk = recipient !== "" && validRecipient(recipient, network);
  /** The explicit reuse check, for one address; in memory only, never stored */
  const [reuse, setReuse] = useState<{ address: string; state: "loading" | "used" | "unused" | "error" } | null>(null);
  const reuseState = reuse?.address === recipient ? reuse.state : null;
  const host = apiHost(config.mempoolBaseUrl);

  function checkReuse() {
    const address = recipient;
    setReuse({ address, state: "loading" });
    createMempoolClient(config.mempoolBaseUrl).getAddress(address)
      .then(d => setReuse({ address, state: d.chain_stats.tx_count + d.mempool_stats.tx_count > 0 ? "used" : "unused" }))
      .catch(() => setReuse({ address, state: "error" }));
  }
  const [includeFrozen, setIncludeFrozen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const frozen = utxos.filter(u => u.frozen).length;
  // New coins or labels: the old advice no longer describes them.
  const [seenUtxos, setSeenUtxos] = useState(utxos);
  if (seenUtxos !== utxos) {
    setSeenUtxos(utxos);
    setAdvice(null);
    setSubmitted(null);
  }

  function run(input: { amount: number; feeRate: number }, withFrozen: boolean, to: string | null = recipientOk ? recipient : null) {
    const coins = withFrozen ? utxos : utxos.filter(u => !u.frozen);
    const known = to && history ? recipientHistory(history, utxos, to) : null;
    const next: Submitted = { ...input, maxAbsorb: parseMaxAbsorb(c.maxAbsorb), recipient: to, history: known };
    setSubmitted(next);
    setAdvice(adviseCoinSelection(coins, input.amount, input.feeRate, next.maxAbsorb, { known: new Set(known?.known.keys()) }));
  }

  // "Compare with suggestions" (from the UTXO list): run with the shared inputs.
  const [seenCompare, setSeenCompare] = useState(0);
  if (seenCompare !== c.compareSeq) {
    setSeenCompare(c.compareSeq);
    if (c.compareSeq > 0) run(parseInputs(c.amount, c.feeRate), includeFrozen);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    run(parseInputs(c.amount, c.feeRate), includeFrozen);
  }

  // The manual selection as one more plan, evaluated at the submitted amount and fee rate.
  const comparing = c.compareSeq > 0 && c.selected.size > 0 && advice?.kind === "plans" && submitted !== null;
  const manual = useMemo(
    () => (comparing ? evaluateSelection(c.utxos, c.selected, submitted.amount, submitted.feeRate, {
      maxAbsorb: submitted.maxAbsorb, absorb: c.absorb, includeFrozen, known: new Set(submitted.history?.known.keys()),
    }) : null),
    [comparing, c.utxos, c.selected, submitted, c.absorb, includeFrozen],
  );
  const entries = useMemo(() => {
    if (advice?.kind !== "plans") return [];
    const key = planKey;
    const mineKey = manual?.kind === "plan" ? key(manual.plan) : null;
    // A suggestion with the same coins is the manual set: marked, not listed twice.
    const list = advice.plans.map(plan => ({ plan, mine: key(plan) === mineKey }));
    if (manual?.kind === "plan" && !list.some(e => e.mine)) list.push({ plan: manual.plan, mine: true });
    const order = rankPlans(list.map(e => e.plan), c.criterion);
    return order.map(p => list.find(e => e.plan === p)!);
  }, [advice, manual, c.criterion]);
  const mineRank = entries.findIndex(e => e.mine);

  const manualRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (c.compareSeq > 0) manualRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [c.compareSeq]);

  const criterionLabel = (k: (typeof PLAN_CRITERIA)[number]) => t(`wallet.coinSel.rank.${k}`);
  const visible = entries.filter((e, i) => showAll || i < COLLAPSED_PLANS || e.mine);
  const alerts = advice?.kind === "plans" && submitted
    ? spendingAlerts({
        amount: submitted.amount,
        recipient: submitted.recipient,
        walletType: walletAddressType(utxos),
        history: submitted.history,
        apiReused: submitted.recipient !== null && reuse?.address === submitted.recipient && reuse.state !== "loading" && reuse.state !== "error" ? reuse.state === "used" : null,
        change: entries[0]?.plan.change ?? 0,
      })
    : [];

  return (
    <div className="space-y-5" data-testid="coin-selector">
      {/* Inputs and button share one grid row aligned to the end, so a wrapped label never shifts them. */}
      <form onSubmit={handleSubmit} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,11rem)_auto] items-end gap-3">
        <div className="min-w-0 col-span-2 sm:col-span-4 space-y-1.5">
          <label htmlFor={`${id}-to`} className="block text-[13px] text-muted">
            {t("wallet.coinSel.recipient", { defaultValue: "Recipient address (optional)" })}
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id={`${id}-to`}
              type="text"
              value={c.recipient}
              onChange={e => c.setRecipient(e.target.value)}
              placeholder={network === "mainnet" ? "bc1q..." : "tb1q..."}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={recipient !== "" && !recipientOk}
              aria-describedby={`${id}-to-note`}
              className={`${FIELD} font-mono text-[13px] min-w-0 flex-1`}
            />
            {recipientOk && (
              <button
                type="button"
                onClick={checkReuse}
                disabled={!apiReady || reuseState === "loading"}
                data-testid="reuse-check"
                className="h-10 px-3.5 rounded-lg border border-card-border text-sm text-foreground hover:border-bitcoin/50 hover:text-bitcoin transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50 disabled:cursor-default"
              >
                {t("wallet.coinSel.reuseCheck", { defaultValue: "Check if this address was used before" })}
              </button>
            )}
          </div>
          <p id={`${id}-to-note`} className="text-[13px] text-muted leading-relaxed">
            {recipient !== "" && !recipientOk
              ? <span className="text-severity-high">{t("wallet.coinSel.recipientInvalid", { defaultValue: "Not a valid address for this network." })}</span>
              : t("wallet.coinSel.recipientNote", { host, defaultValue: "Checked against this wallet's history on this device. The button sends this one address to {{host}}, only when clicked." })}
            {" "}
            <a href="/guide/#spending-checklist" className="text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline whitespace-nowrap">
              {t("wallet.coinSel.checklistLink", { defaultValue: "Spending checklist" })}
            </a>
          </p>
          {reuseState && reuseState !== "used" && (
            <p role="status" data-testid="reuse-result" className={`text-[13px] ${reuseState === "error" ? "text-severity-high" : "text-muted"}`}>
              {reuseState === "loading" ? t("wallet.coinSel.reuseLoading", { host, defaultValue: "Asking {{host}}..." })
                : reuseState === "unused" ? t("wallet.coinSel.reuseUnused", { host, defaultValue: "No earlier transactions for this address on {{host}}." })
                : t("wallet.coinSel.reuseError", { defaultValue: "The check failed. Try again later." })}
            </p>
          )}
          {reuseState === "used" && (
            <p role="status" data-testid="reuse-result" className="text-[13px] text-severity-critical">
              {t("wallet.coinSel.reuseUsed", { host, defaultValue: "{{host}} shows earlier transactions for this address." })}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-amount`} className="block text-[13px] text-muted mb-1.5">
            {t("wallet.coinSel.amount", { defaultValue: "Amount (sats)" })}
          </label>
          <input id={`${id}-amount`} type="number" inputMode="numeric" value={c.amount} onChange={e => c.setAmount(e.target.value)} placeholder="50000" min="1" className={FIELD} />
        </div>
        <div className="min-w-0">
          <label htmlFor={`${id}-fee`} className="block text-[13px] text-muted mb-1.5">
            {t("wallet.coinSel.feeRate", { defaultValue: "Fee (sat/vB)" })}
          </label>
          <input id={`${id}-fee`} type="number" inputMode="decimal" value={c.feeRate} onChange={e => c.setFeeRate(e.target.value)} placeholder="5" min="0.1" step="any" className={FIELD} />
        </div>
        <div className="min-w-0 col-span-2 sm:col-span-1">
          <label htmlFor={`${id}-absorb`} className="block text-[13px] text-muted mb-1.5" title={t("wallet.coinSel.maxAbsorbTitle", { defaultValue: "Change at or below this is also offered as a no-change option: the change goes to miners instead. 0 turns it off." })}>
            {t("wallet.coinSel.maxAbsorb", { defaultValue: "Max extra fee to avoid change" })}
          </label>
          <input id={`${id}-absorb`} type="number" inputMode="numeric" value={c.maxAbsorb} onChange={e => c.setMaxAbsorb(e.target.value)} placeholder="5000" min="0" className={FIELD} />
        </div>
        <button
          type="submit"
          className="col-span-2 sm:col-span-1 h-10 px-4 bg-bitcoin text-black font-semibold text-sm rounded-lg hover:bg-bitcoin-hover transition-colors cursor-pointer whitespace-nowrap"
        >
          {t("wallet.suggest", { defaultValue: "Suggest selection" })}
        </button>
      </form>

      {frozen > 0 && (
        <label className="flex items-center gap-2 min-h-10 text-[13px] text-muted cursor-pointer w-fit">
          <input
            type="checkbox"
            checked={includeFrozen}
            onChange={e => { setIncludeFrozen(e.target.checked); if (submitted) run(submitted, e.target.checked, submitted.recipient); }}
            className="size-4 accent-bitcoin"
          />
          {t("wallet.labels.includeFrozen", { count: frozen, n: fmtN(frozen), defaultValue: "Include frozen coins ({{n}})" })}
        </label>
      )}

      {advice?.kind === "invalid" && (
        <p role="alert" className="text-sm text-severity-high">
          {t("wallet.coinSel.invalid", { defaultValue: "Enter a whole amount in sats and a fee rate above zero." })}
        </p>
      )}

      {advice?.kind === "insufficient" && (
        <p role="status" className="rounded-lg border border-severity-high/25 bg-severity-high/5 px-4 py-3 text-sm text-foreground">
          {t("wallet.coinSel.insufficient", {
            spendable: fmtN(advice.spendable),
            shortfall: fmtN(advice.shortfall),
            defaultValue: "Not enough funds. The spendable balance is {{spendable}} sats, {{shortfall}} sats short of the amount plus fee.",
          })}
        </p>
      )}

      {alerts.length > 0 && <SpendAlerts alerts={alerts} />}

      {advice?.kind === "plans" && (
        <div className="space-y-3">
          <p role="status" className="sr-only">
            {t("wallet.coinSel.summary", {
              count: advice.plans.length,
              strategy: t(`wallet.coinSel.strategy.${advice.plans[0]!.strategy}`),
              defaultValue: "Options found: {{count}}. Recommended: {{strategy}}.",
            })}
          </p>
          {entries.length > 1 && (
            <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap" role="group" aria-labelledby={`${id}-rank`}>
              <span id={`${id}-rank`} className="text-[13px] text-muted mr-1">{t("wallet.coinSel.rankBy", { defaultValue: "Rank by" })}</span>
              <div data-testid="plan-criterion" className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-inset p-1">
                {PLAN_CRITERIA.map(k => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={c.criterion === k}
                    onClick={() => c.setCriterion(k)}
                    className={`h-9 px-3 rounded-md text-[13px] whitespace-nowrap transition-colors cursor-pointer ${c.criterion === k ? "bg-surface-2 text-foreground shadow-(--shadow-card)" : "text-muted hover:text-foreground"}`}
                  >
                    {criterionLabel(k)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {manual && manual.kind !== "plan" && (
            <p data-testid="manual-short" className="rounded-lg border border-dashed border-hairline-strong px-4 py-3 text-sm text-muted">
              {manual.kind === "insufficient"
                ? t("wallet.coinControl.compareShort", { amount: fmtN(manual.shortfall), defaultValue: "Your selection is {{amount}} sats short of the amount plus fee, so it is not ranked." })
                : t("wallet.coinSel.invalid", { defaultValue: "Enter a whole amount in sats and a fee rate above zero." })}
            </p>
          )}
          {visible.map(({ plan, mine }) => {
            const i = entries.findIndex(e => e.plan === plan);
            return (
              <PlanCard
                key={planKey(plan)}
                ref={mine ? manualRef : undefined}
                plan={plan}
                maxAbsorb={submitted?.maxAbsorb ?? 0}
                recommended={c.criterion === "privacy" && i === 0 && entries.length > 1}
                mine={mine ? { rank: mineRank + 1, of: entries.length, criterion: criterionLabel(c.criterion) } : undefined}
              />
            );
          })}
          {entries.length > COLLAPSED_PLANS && (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll(s => !s)}
              className="text-[13px] text-bitcoin hover:text-bitcoin-hover min-h-[44px] cursor-pointer"
            >
              {showAll
                ? t("wallet.coinSel.showFewer", { defaultValue: "Show fewer options" })
                : t("wallet.coinSel.showAll", { n: fmtN(entries.length), defaultValue: "Show all {{n}} options" })}
            </button>
          )}
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

      {advice && advice.kind !== "invalid" && advice.uneconomical > 0 && (
        <p className="text-[13px] text-muted">
          {t("wallet.coinSel.uneconomical", { count: advice.uneconomical, defaultValue: "Coins left out because they cost more in fee than they are worth at this fee rate: {{count}}." })}
        </p>
      )}

      {advice && advice.kind !== "invalid" && advice.dustExcluded > 0 && (
        <p className="text-[13px] text-muted">
          {t("wallet.coinSel.dustExcluded", { count: advice.dustExcluded, defaultValue: "Dust coins left out: {{count}}. They may come from a dust attack, and spending them links them to the rest of the wallet." })}
        </p>
      )}
    </div>
  );
}

/** Upper-case script type for display ("p2tr" to "P2TR"). */
const typeName = (t?: string) => (t ?? "").toUpperCase();

const ALERT_TONE: Record<Severity, string> = {
  critical: "border-severity-critical/30 bg-severity-critical/5",
  high: "border-severity-high/25 bg-severity-high/5",
  medium: "border-severity-medium/25 bg-severity-medium/5",
  low: "border-hairline bg-surface-2/40",
  good: "border-severity-good/20 bg-severity-good/5",
};

/** Alerts about the recipient and the amount (rules 3, 6, 7 of the spending checklist), above the plans. */
function SpendAlerts({ alerts }: { alerts: SpendAlert[] }) {
  const { t } = useTranslation();
  return (
    <ul data-testid="spend-alerts" className="space-y-2">
      {alerts.map(a => (
        <li
          key={a.id}
          data-testid={`spend-alert-${a.id}`}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${ALERT_TONE[a.severity]}`}
        >
          <span className={`mt-[7px] w-2 h-2 rounded-full shrink-0 ${SEVERITY_STYLES[a.severity].dot}`} aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-foreground">{t(`wallet.coinSel.alert.${a.id}.title`)}</p>
            <p className="text-[13px] text-muted leading-relaxed">
              {t(`wallet.coinSel.alert.${a.id}.body`, { sent: fmtN(a.sent ?? 0), paid: fmtN(a.paid ?? 0), amount: fmtN(a.amount ?? 0), to: typeName(a.to), from: typeName(a.from) })}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The plan's steps through the spending checklist, each passed or not. */
function DecisionPath({ plan }: { plan: CoinSelectionPlan }) {
  const { t } = useTranslation();
  return (
    <div data-testid="plan-path" className="space-y-1.5">
      <span className="eyebrow block">{t("wallet.coinSel.pathTitle", { defaultValue: "Decision path" })}</span>
      <ol className="space-y-1">
        {plan.path.map(s => (
          <li key={s.id} className="flex items-start gap-2 text-[13px] leading-relaxed">
            <span className="num text-faint w-3 shrink-0 text-right">{s.rule}</span>
            {s.ok
              ? <Check size={14} className="mt-[3px] shrink-0 text-severity-good" aria-hidden="true" />
              : <AlertTriangle size={14} className="mt-[3px] shrink-0 text-severity-medium" aria-hidden="true" />}
            <span className="sr-only">{s.ok ? t("wallet.coinSel.pathOk", { defaultValue: "Passed:" }) : t("wallet.coinSel.pathWarn", { defaultValue: "Warning:" })}</span>
            <span className="text-foreground/90 min-w-0">{t(`wallet.coinSel.path.${s.id}`, { n: fmtN(s.n ?? 0), amount: fmtN(s.amount ?? 0), name: s.name ?? "" })}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PlanCard({ plan, maxAbsorb, recommended, mine, ref }: {
  plan: CoinSelectionPlan;
  /** Max extra fee: caps the round-change nudge */
  maxAbsorb: number;
  recommended: boolean;
  /** The user's own selection, with its rank under the current criterion */
  mine?: { rank: number; of: number; criterion: string };
  ref?: React.Ref<HTMLElement>;
}) {
  const { t } = useTranslation();
  const sats = t("common.sats", { defaultValue: "sats" });
  const round = roundChange(plan, maxAbsorb);
  const note =
    plan.strategy === "single-coin" ? (plan.change > 0 ? "singleChange" : "single")
    : plan.strategy === "no-change" ? "noChange"
    : plan.strategy === "same-origin" ? "linked"
    : plan.strategy === "probably-linked" ? "probablyLinked" : "merge";
  const stats = [
    { label: t("wallet.coinSel.inputs", { defaultValue: "Inputs" }), value: fmtN(plan.selected.length) },
    { label: t("wallet.coinSel.fee", { defaultValue: "Fee" }), value: `${fmtN(plan.fee)} ${sats}` },
    { label: t("wallet.coinSel.change", { defaultValue: "Change" }), value: plan.change > 0 ? `${fmtN(plan.change)} ${sats}` : t("wallet.coinSel.noChange", { defaultValue: "No change" }) },
    {
      label: t("wallet.coinSel.origins", { defaultValue: "Origins" }),
      // Coins only probably linked count as one origin, said so
      value: plan.strategy === "probably-linked"
        ? t("wallet.coinSel.originsProbable", { count: plan.groups, n: fmtN(plan.groups), defaultValue: "{{n}} (probably linked)" })
        : fmtN(plan.groups),
    },
  ];

  return (
    <section
      ref={ref}
      data-testid={mine ? "coin-plan-manual" : `coin-plan-${plan.strategy}`}
      className={`rounded-lg border p-4 space-y-4 scroll-mt-24 ${mine ? "border-bitcoin/40 bg-bitcoin/5" : "border-hairline bg-surface-2/40"}`}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-[15px] font-medium text-foreground">
            {mine ? t("wallet.coinControl.yours", { defaultValue: "Your selection" }) : t(`wallet.coinSel.strategy.${plan.strategy}`)}
          </h3>
          {recommended && (
            <span className="text-[11px] leading-none rounded px-1.5 py-1 bg-severity-good/10 text-severity-good">
              {t("wallet.coinSel.recommended", { defaultValue: "Recommended" })}
            </span>
          )}
          {plan.absorbsChange && (
            <span data-testid="plan-absorbs" className="text-[11px] leading-none rounded px-1.5 py-1 bg-severity-low/10 text-severity-low whitespace-nowrap">
              {t("wallet.coinSel.absorbBadge", { amount: fmtN(plan.absorbed), defaultValue: "No change: +{{amount}} sats to miners" })}
            </span>
          )}
          {mine && (
            <span data-testid="manual-rank" className="text-[11px] leading-none rounded px-1.5 py-1 bg-bitcoin/10 text-bitcoin">
              {t("wallet.coinControl.rank", { n: mine.rank, of: mine.of, criterion: mine.criterion, defaultValue: "#{{n}} of {{of}} by {{criterion}}" })}
            </span>
          )}
        </div>
        <p className="text-sm text-muted leading-relaxed">{t(`wallet.coinSel.note.${note}`)}</p>
        <p data-testid="plan-reason" className="text-sm text-foreground leading-relaxed">
          {t(`wallet.coinSel.reason.${plan.reason}`, { count: plan.groups, ratio: fmtN(Math.round(plan.change / plan.paymentAmount)) })}
          {plan.absorbsChange && <> {t("wallet.coinSel.absorbReason", { amount: fmtN(plan.absorbed), defaultValue: "Pays {{amount}} sats more fee so no change is left." })}</>}
        </p>
        {plan.absorbed > 0 && !plan.absorbsChange && (
          <p className="text-[13px] text-muted leading-relaxed">
            {t("wallet.coinSel.absorbed", { amount: fmtN(plan.absorbed), defaultValue: "The fee includes {{amount}} sats of leftover, too small to be worth a change output." })}
          </p>
        )}
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
                {c.label && <LabelText text={c.label} className="block" />}
                {(c.hints.length > 0 || (c.labelTags?.length ?? 0) > 0 || c.frozen) && (
                  <div className="flex flex-wrap gap-1.5">
                    {c.labelTags?.map(tag => <LabelTagChip key={tag} tag={tag} />)}
                    {c.frozen && <HintChip hint={{ kind: "frozen" }} />}
                    {c.hints.map(h => <HintChip key={h.kind} hint={h} />)}
                  </div>
                )}
              </div>
              <span className="num text-[13px] text-foreground text-right shrink-0">{fmtN(c.utxo.value)} {sats}</span>
            </li>
          ))}
        </ol>
      </div>

      {round && (
        <p data-testid="round-change" className="rounded-lg border border-dashed border-hairline-strong px-3 py-2.5 text-[13px] leading-relaxed">
          <span className="text-foreground">{t("wallet.coinSel.roundChange", { amount: fmtN(round.extra), defaultValue: "Round change: +{{amount}} sats fee so the change also looks round" })}</span>
          {" "}
          <span className="text-muted">{t("wallet.coinSel.roundChangeDetail", { fee: fmtN(round.fee), change: fmtN(round.change), defaultValue: "Fee {{fee}} sats, change {{change}} sats." })}</span>
        </p>
      )}

      <DecisionPath plan={plan} />
      <PlanRules plan={plan} />
      <PlanWarnings plan={plan} />
    </section>
  );
}

/** Label rules that apply to the coins, each respected or broken. */
export function PlanRules({ plan }: { plan: CoinSelectionPlan }) {
  const { t } = useTranslation();
  if (plan.labelRules.length === 0) return null;
  return (
    <div data-testid="plan-label-rules" className="space-y-1.5">
      <span className="eyebrow block">{t("wallet.labels.rules", { defaultValue: "Label rules" })}</span>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {plan.labelRules.map(r => (
          <li key={r.id} className={`inline-flex items-center gap-1.5 text-[13px] ${r.ok ? "text-severity-good" : "text-severity-critical"}`}>
            {r.ok ? <Check size={14} aria-hidden="true" /> : <X size={14} aria-hidden="true" />}
            <span className="sr-only">{r.ok ? t("wallet.labels.ruleOk", { defaultValue: "Respected:" }) : t("wallet.labels.ruleBroken", { defaultValue: "Broken:" })}</span>
            {t(`wallet.labels.rule.${r.id}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Label warnings and the spending rule each breaks (guide, LabelingSection anchors). */
const RULE_OF: Partial<Record<PlanWarningId, number>> = { "label-kyc": 1, "label-coinjoin": 2, "label-origins": 3, "label-toxic": 5 };

/** A plan's warnings, most severe first as the advisor orders them; a label warning links to its rule. */
export function PlanWarnings({ plan }: { plan: CoinSelectionPlan }) {
  const { t } = useTranslation();
  if (plan.warnings.length === 0) return null;
  return (
    <ul className="space-y-1.5">
      {plan.warnings.map(w => (
        <li key={w.id} className="flex items-start gap-2.5 text-sm text-foreground">
          <span className={`mt-[7px] w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_STYLES[w.severity].dot}`} aria-hidden="true" />
          <span>
            {t(`wallet.coinSel.warn.${w.id}`, { count: w.count, amount: fmtN(w.count) })}
            {RULE_OF[w.id] !== undefined && (
              <>
                {" "}
                <a href={`/guide/#labeling-rule-${RULE_OF[w.id]}`} className="text-bitcoin hover:text-bitcoin-hover underline-offset-2 hover:underline">
                  {t("wallet.labels.ruleLink", { n: RULE_OF[w.id], rule: t(`guide.labeling.ruleShort${RULE_OF[w.id]}`), defaultValue: "Rule {{n}}: {{rule}}" })}
                </a>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}
