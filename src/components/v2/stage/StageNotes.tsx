"use client";

import { useTranslation } from "react-i18next";
import { formatSats } from "@/lib/format";
import { probColor } from "@/components/viz/shared/linkabilityColors";
import type { TxReadings } from "./analyst";
import { useStage } from "./StageContext";
import { shortTxid } from "./StageTag";

/** Transaction-level surveillance reading, shown above the diagram in Analyst view. */
export function AnalystSummary({ readings, hasLookup }: { readings: TxReadings; hasLookup: boolean }) {
  const { t, i18n } = useTranslation();
  const { onFindingClick, onTxClick, isRevealed } = useStage();
  const vals = [...readings.outputs.values()].filter((r) => isRevealed(r.findingId));
  // Only summarize when the change reading is confident enough to imply payments.
  const change = vals.find((r) => r.kind === "change" && r.confidence !== "low");
  const items: { key: string; text: string; findingId?: string; txid?: string }[] = [];

  if (change) {
    items.push({
      key: "change",
      findingId: change.findingId,
      text: t("v2.stage.analyst.summaryChange", { defaultValue: "The change output is likely identified, so the other outputs likely read as payments." }),
    });
  }
  if (readings.blinded && isRevealed(readings.blinded.findingId)) {
    const tiers = readings.blinded.tiers.slice(0, 3).map((x) => `${x.count} × ${formatSats(x.unit, i18n.language)}`).join(", ");
    items.push({
      key: "blinded",
      findingId: readings.blinded.findingId,
      text: t("v2.stage.analyst.summaryBlinded", { tiers: tiers, defaultValue: "CoinJoin: outputs are blinded inside equal-value tiers ({{tiers}})." }),
    });
    items.push({
      key: "links",
      text: hasLookup
        ? t("v2.stage.analyst.linksReal", { defaultValue: "Link percentages are real Boltzmann probabilities." })
        : t("v2.stage.analyst.linksUnknown", { defaultValue: "Which input funded which output cannot be read from the structure alone." }),
    });
  }
  for (const e of readings.entities) {
    if (!isRevealed(e.findingId)) continue;
    items.push({
      key: `entity-${e.side}-${e.name}-${e.ofac}`,
      findingId: e.findingId,
      text: e.ofac
        ? t("v2.stage.analyst.entityOfac", { name: e.name, defaultValue: "{{name}} is on the OFAC sanctions list." })
        : e.side === "input"
          ? t("v2.stage.analyst.entityIn", { name: e.name, defaultValue: "Funds come from {{name}}, a known entity." })
          : t("v2.stage.analyst.entityOut", { name: e.name, defaultValue: "Funds go to {{name}}, a known entity." }),
    });
  }
  for (const p of readings.p2p) {
    if (!isRevealed(p.findingId)) continue;
    items.push({
      key: `p2p-${p.name}`,
      findingId: p.findingId,
      text: t("v2.stage.analyst.p2p", { name: p.name, defaultValue: "An escrow fee output marks this as a {{name}} P2P trade." }),
    });
  }
  for (const g of readings.coSpent) {
    items.push({
      key: `co-${g.txid}`,
      txid: g.txid,
      text: readings.blinded
        ? t("v2.stage.analyst.coSpentMix", { n: g.count, txid: shortTxid(g.txid), defaultValue: "{{n}} outputs were later spent together in {{txid}}, which undoes the mix for them." })
        : t("v2.stage.analyst.coSpent", { n: g.count, txid: shortTxid(g.txid), defaultValue: "{{n}} outputs were later spent together in {{txid}}, linking them to one owner." }),
    });
  }
  for (const g of readings.sameParent) {
    items.push({
      key: `parent-${g.txid}`,
      txid: g.txid,
      text: t("v2.stage.analyst.sameParent", { n: g.count, txid: shortTxid(g.txid), defaultValue: "{{n}} inputs come from the same earlier transaction {{txid}}." }),
    });
  }
  if (readings.cluster && isRevealed(readings.cluster.findingId)) {
    items.push({
      key: "cluster",
      findingId: readings.cluster.findingId,
      text: t("v2.stage.analyst.summaryCluster", { n: readings.cluster.inputCount, defaultValue: "All {{n}} inputs are read as one owner." }),
    });
  }
  if (readings.wallet && isRevealed(readings.wallet.findingId)) {
    items.push({
      key: "wallet",
      findingId: readings.wallet.linkable ? readings.wallet.findingId : undefined,
      text: t("v2.stage.analyst.wallet", { name: readings.wallet.name, defaultValue: "Wallet fingerprint: {{name}}." }),
    });
  }

  return (
    <div data-testid="stage-analyst" className="mx-3 mb-4 rounded-lg border border-bitcoin/25 bg-bitcoin/[0.04] px-3 py-2.5">
      <p className="v2-eyebrow !text-bitcoin/80">{t("v2.stage.analyst.eyebrow", { defaultValue: "What an analyst reads" })}</p>
      {items.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-muted">{t("v2.stage.analyst.none", { defaultValue: "No surveillance reading beyond the raw flow." })}</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {items.map((it) => (
            <li key={it.key} className="text-[13px] leading-snug text-foreground/90">
              {it.findingId || (it.txid && onTxClick) ? (
                <button
                  type="button"
                  onClick={() => (it.findingId ? onFindingClick?.(it.findingId) : onTxClick?.(it.txid!))}
                  className="text-left hover:text-foreground hover:underline underline-offset-2 decoration-bitcoin/50 cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-bitcoin"
                >
                  {it.text}
                </button>
              ) : <span className="text-muted">{it.text}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Color scale for linkability mode. */
export function LinkLegend({ timedOut }: { timedOut: boolean }) {
  const { t } = useTranslation();
  const stops = [0.05, 0.25, 0.5, 0.75, 1].map((p) => probColor(p)).join(", ");
  return (
    <div className="mx-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
      <span>{t("v2.stage.linkLegend", { defaultValue: "Link probability (Boltzmann)" })}</span>
      <span className="v2-num text-faint">0%</span>
      <span aria-hidden="true" className="h-1.5 w-28 rounded-full" style={{ background: `linear-gradient(90deg, ${stops})` }} />
      <span className="v2-num text-faint">100%</span>
      <span className="text-faint">{t("v2.stage.linkHint", { defaultValue: "Hover or tap a row to see its links." })}</span>
      {timedOut && (
        <span className="text-severity-medium">{t("v2.stage.linkTimedOut", { defaultValue: "Computation timed out: dashed links are unreliable." })}</span>
      )}
    </div>
  );
}
