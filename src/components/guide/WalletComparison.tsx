"use client";

import { ExternalLink, Shield, ShieldX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { WalletIcon } from "@/components/ui/WalletIcon";
import { RECOMMENDED_WALLETS, WALLETS_TO_AVOID, WALLET_CRITERIA } from "@/data/guide/wallets";

function BoolCell({ value }: { value: boolean | "partial" | "native" | "is-node" | "v1-only" | "send-only" | "stowaway" }) {
  const { t } = useTranslation();
  if (value === true) return <span className="text-severity-good">&#10003;</span>;
  if (value === false) return <span className="text-muted">&#10007;</span>;
  if (value === "is-node") return <span className="text-severity-good text-xs">{t("walletGuide.isNode", { defaultValue: "Is the node" })}</span>;
  if (value === "native") return <span className="text-severity-good text-xs">{t("walletGuide.native", { defaultValue: "Native" })}</span>;
  if (value === "v1-only") return <span className="text-severity-medium text-xs">{t("walletGuide.v1Only", { defaultValue: "v1 only" })}</span>;
  if (value === "send-only") return <span className="text-severity-medium text-xs">{t("walletGuide.sendOnly", { defaultValue: "Send only" })}</span>;
  if (value === "stowaway") return <span className="text-severity-medium text-xs">{t("walletGuide.stowaway", { defaultValue: "Stowaway" })}</span>;
  return <span className="text-severity-medium text-xs">{t("walletGuide.partial", { defaultValue: "Partial" })}</span>;
}

function TypeBadge({ type }: { type: ("desktop" | "mobile" | "hardware")[] }) {
  const { t } = useTranslation();
  const config = {
    desktop: { label: t("walletGuide.typeDesktop", { defaultValue: "Desktop" }), cls: "bg-severity-low/15 text-severity-low" },
    mobile: { label: t("walletGuide.typeMobile", { defaultValue: "Mobile" }), cls: "bg-severity-good/15 text-severity-good" },
    hardware: { label: t("walletGuide.typeHardware", { defaultValue: "Hardware" }), cls: "bg-severity-medium/15 text-severity-medium" },
  };
  return (
    <span className="inline-flex gap-1 flex-wrap justify-center">
      {type.map((tp) => {
        const c = config[tp];
        return <span key={tp} className={`text-xs px-1.5 py-0.5 rounded ${c.cls}`}>{c.label}</span>;
      })}
    </span>
  );
}

export function WalletComparison() {
  const { t } = useTranslation();

  return (
    <section className="space-y-4">
      <h2 id="wallet-comparison" className="text-2xl font-bold text-foreground scroll-mt-24">
        <Shield size={20} className="inline mr-2 text-bitcoin" />
        {t("guide.walletsTitle", { defaultValue: "Wallet comparison" })}
      </h2>

      {/* Recommended wallets table */}
      <div className="bg-surface-inset rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-card-border">
          <h3 className="text-sm font-medium text-foreground/90">
            {t("walletGuide.recommendedTitle", { defaultValue: "Recommended wallets - low on-chain footprint" })}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-xs text-muted">
                <th className="text-left px-4 py-2 font-medium">{t("walletGuide.colWallet", { defaultValue: "Wallet" })}</th>
                <th className="text-center px-2 py-2 font-medium">{t("walletGuide.colType", { defaultValue: "Type" })}</th>
                <th className="text-center px-2 py-2 font-medium whitespace-nowrap">nSeq</th>
                <th className="text-center px-2 py-2 font-medium whitespace-nowrap">{t("walletGuide.colAntiFeeSniping", { defaultValue: "Anti-snip" })}</th>
                <th className="text-center px-2 py-2 font-medium">CoinJoin</th>
                <th className="text-center px-2 py-2 font-medium whitespace-nowrap">{t("walletGuide.colPayJoin", { defaultValue: "PayJoin" })}</th>
                <th className="text-center px-2 py-2 font-medium whitespace-nowrap" title="BIP47 / Paynym">{t("walletGuide.colBip47", { defaultValue: "BIP47" })}</th>
                <th className="text-center px-2 py-2 font-medium whitespace-nowrap" title="Silent Payments (BIP352)">{t("walletGuide.colSilentPay", { defaultValue: "SP" })}</th>
                <th className="text-center px-2 py-2 font-medium">{t("walletGuide.colOwnNode", { defaultValue: "Own Node" })}</th>
                <th className="text-center px-2 py-2 font-medium">Tor</th>
              </tr>
            </thead>
            <tbody>
              {RECOMMENDED_WALLETS.map((w) => (
                <tr key={w.name} className="border-b border-card-border/50 hover:bg-surface-elevated/50 transition-colors">
                  <td className="px-4 py-2">
                    <a
                      href={w.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-bitcoin hover:text-bitcoin-hover transition-colors"
                    >
                      <WalletIcon walletName={w.name} size="md" />
                      {w.name}
                      <ExternalLink size={12} />
                    </a>
                  </td>
                  <td className="text-center px-2 py-2"><TypeBadge type={w.type} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.nSequence === "good"} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.antiFeeSniping} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.coinJoin} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.payJoin} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.bip47} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.silentPayments} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.ownNode} /></td>
                  <td className="text-center px-2 py-2"><BoolCell value={w.tor} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Wallets to avoid */}
      <div className="bg-severity-critical/5 border border-severity-critical/20 rounded-lg px-4 py-3">
        <h3 className="text-sm font-medium text-severity-critical mb-2">
          {t("walletGuide.avoidTitle", { defaultValue: "Wallets to avoid for privacy" })}
        </h3>
        <ul className="space-y-1.5">
          {WALLETS_TO_AVOID.map((w) => (
            <li key={w.name} className="flex items-start gap-2 text-sm text-muted">
              <WalletIcon walletName={w.name} size="sm" className="mt-0.5" />
              <ShieldX size={14} className="text-severity-critical shrink-0 mt-0.5" />
              <span>
                <strong className="text-foreground/90">{w.name}</strong>
                {" - "}
                {t(w.reasonKey, { defaultValue: w.reasonDefault })}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Good vs bad criteria */}
      <div className="bg-surface-inset rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-card-border">
          <h3 className="text-sm font-medium text-foreground/90">
            {t("walletGuide.criteriaTitle", { defaultValue: "What makes a wallet good or bad for privacy" })}
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-card-border text-xs text-muted">
                <th className="text-left px-4 py-2 font-medium">{t("walletGuide.colCriteria", { defaultValue: "Criteria" })}</th>
                <th className="text-left px-3 py-2 font-medium text-severity-good">{t("walletGuide.colGood", { defaultValue: "Good" })}</th>
                <th className="text-left px-3 py-2 font-medium text-severity-critical">{t("walletGuide.colBad", { defaultValue: "Bad" })}</th>
              </tr>
            </thead>
            <tbody>
              {WALLET_CRITERIA.map((row) => (
                <tr key={row.criteria} className="border-b border-card-border/50">
                  <td className="px-4 py-2 font-mono text-xs text-foreground/90">
                    {t(row.criteriaKey, { defaultValue: row.criteria })}
                  </td>
                  <td className="px-3 py-2 text-xs text-severity-good">
                    {t(row.goodKey, { defaultValue: row.good })}
                  </td>
                  <td className="px-3 py-2 text-xs text-severity-critical">
                    {t(row.badKey, { defaultValue: row.bad })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fingerprint contradiction */}
      <div className="bg-surface-inset rounded-lg px-4 py-3 border-l-2 border-l-bitcoin/50">
        <h3 className="text-sm font-medium text-foreground/90 mb-2">
          {t("walletGuide.contradictionTitle", { defaultValue: "Why recommend wallets that have fingerprints?" })}
        </h3>
        <div className="text-sm text-muted space-y-2 leading-relaxed">
          <p className="text-sm">{t("walletGuide.contradictionP1", { defaultValue: "Every wallet leaves a fingerprint - that is unavoidable. The goal is not to be invisible, but to be indistinguishable from millions of other users." })}</p>
          <p className="text-sm">{t("walletGuide.contradictionP2", { defaultValue: "A Bitcoin Core fingerprint is shared by millions of transactions. Knowing someone uses Bitcoin Core reveals almost nothing useful. An Exodus fingerprint, on the other hand, reveals poor privacy practices (no coin control, no Tor, centralized servers) and belongs to a much smaller set." })}</p>
          <p className="text-sm text-foreground/80 font-medium">{t("walletGuide.contradictionP3", { defaultValue: "Choose wallets where the fingerprint says \"one of millions\" rather than \"one of a few with poor habits.\"" })}</p>
        </div>
      </div>
    </section>
  );
}
