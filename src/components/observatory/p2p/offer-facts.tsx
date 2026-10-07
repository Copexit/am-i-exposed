"use client";

import { useTranslation } from "react-i18next";
import { Blocks, ExternalLink, Zap } from "lucide-react";
import type { P2pOffer, VenueHost } from "@/lib/observatory/p2p/types";
import { fmtFiatRange, fmtPremium, fmtSatsBtc } from "@/lib/observatory/p2p/p2p-format";
import { hostColorVar } from "@/lib/observatory/p2p/venue-palette";
import { safeHttpUrl } from "@/lib/observatory/obs-format";
import { VENUE_LABEL } from "./p2p-ui";

/** Host key -> display name (coordinator, Mostro instance or HodlHodl). */
export const hostNames = (hosts: VenueHost[]): Map<string, string> => new Map(hosts.map((h) => [`${h.venue}:${h.key}`, h.name]));

export const hostName = (names: Map<string, string>, o: P2pOffer): string =>
  names.get(`${o.venue}:${o.host}`) ?? (o.venue === "mostro" ? o.host.slice(0, 8) : o.host);

/**
 * Tone of a premium relative to the market median, from the visitor's side: better than the median
 * is good, a little worse is medium, more than 3 points worse is high.
 */
export function premiumTone(p: number | null, median: number | null, intent: "buy" | "sell"): string {
  if (p === null || median === null) return "text-muted";
  const worse = intent === "buy" ? p - median : median - p;
  return worse <= 0 ? "text-severity-good" : worse <= 3 ? "text-severity-medium" : "text-severity-high";
}

export function UnlistedChip() {
  const { t } = useTranslation();
  return (
    <span
      title={t("observatory.p2p.offer.unlistedHint", { defaultValue: "This Mostro instance is not on the am-i.exposed list of known instances. Its offers are shown but left out of the headline, medians and the premium board." })}
      className="inline-flex shrink-0 items-center rounded-md border border-severity-medium/40 px-1.5 py-px text-[10px] leading-tight text-severity-medium"
    >
      {t("observatory.p2p.offer.unlisted", { defaultValue: "Unlisted instance" })}
    </span>
  );
}

export function VenueBadge({ offer, names }: { offer: P2pOffer; names: Map<string, string> }) {
  const color = hostColorVar(offer.venue, offer.host);
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0">
        <span className="block text-sm text-foreground leading-tight">{VENUE_LABEL[offer.venue]}</span>
        {offer.venue !== "hodlhodl" && (
          <span className="block truncate text-xs text-faint leading-tight" title={offer.venue === "mostro" ? offer.host.slice(0, 16) : undefined}>{hostName(names, offer)}</span>
        )}
        {offer.unlisted && <span className="mt-0.5 block"><UnlistedChip /></span>}
      </span>
    </span>
  );
}

export function LayerLabel({ offer }: { offer: P2pOffer }) {
  const { t } = useTranslation();
  const Icon = offer.layer === "lightning" ? Zap : Blocks;
  const label = offer.layer === "lightning"
    ? t("observatory.p2p.offer.lightning", { defaultValue: "Lightning" })
    : offer.layer === "onchain"
      ? t("observatory.p2p.offer.onchain", { defaultValue: "On-chain" })
      : t("observatory.p2p.offer.otherLayer", { defaultValue: "Other" });
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-muted whitespace-nowrap">
      <Icon size={13} aria-hidden="true" className="text-faint" />
      {label}
    </span>
  );
}

export function EscrowLabel({ offer }: { offer: P2pOffer }) {
  const { t, i18n } = useTranslation();
  if (offer.venue === "robosats") {
    return offer.bondPct !== null
      ? <>{t("observatory.p2p.offer.bond", { defaultValue: "{{pct}} bond", pct: `${offer.bondPct.toLocaleString(i18n.language || "en", { maximumFractionDigits: 2 })}%` })}</>
      : <>{t("observatory.p2p.offer.bondUnknown", { defaultValue: "Bond" })}</>;
  }
  return offer.venue === "mostro"
    ? <>{t("observatory.p2p.offer.holdInvoice", { defaultValue: "Hold invoice" })}</>
    : <>{t("observatory.p2p.offer.multisig", { defaultValue: "2-of-3 multisig" })}</>;
}

export function Amount({ offer }: { offer: P2pOffer }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const fiat = fmtFiatRange(offer.fiatMin, offer.fiatMax, offer.currency, locale);
  return (
    <span className="block min-w-0">
      <span className="num block text-sm text-foreground">{fiat ?? "–"}</span>
      <span className="num block text-xs text-faint">
        {offer.satsMax !== null
          ? t("observatory.p2p.offer.upToBtc", { defaultValue: "up to {{btc}} BTC", btc: fmtSatsBtc(offer.satsMax, locale) })
          : t("observatory.p2p.offer.btcNa", { defaultValue: "BTC n/a" })}
      </span>
    </span>
  );
}

export function PremiumValue({ offer, median, intent, className = "" }: { offer: P2pOffer; median: number | null; intent: "buy" | "sell"; className?: string }) {
  const { t, i18n } = useTranslation();
  return offer.premium === null
    ? <span className={`num text-faint ${className}`}>{t("observatory.p2p.offer.na", { defaultValue: "n/a" })}</span>
    : <span className={`num ${premiumTone(offer.premium, median, intent)} ${className}`}>{fmtPremium(offer.premium, i18n.language || "en")}</span>;
}

export function Methods({ methods }: { methods: string[] }) {
  if (!methods.length) return <span className="text-faint">{"–"}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {methods.map((m) => (
        <span key={m} className="max-w-[12rem] truncate rounded-md border border-hairline bg-surface-inset px-1.5 py-0.5 text-xs text-muted">{m}</span>
      ))}
    </span>
  );
}

/** External order link: RoboSats onion pages say "Tor"; Mostro has no web order page. */
export function OpenLink({ offer }: { offer: P2pOffer }) {
  const { t } = useTranslation();
  const href = safeHttpUrl(offer.link);
  if (offer.venue === "mostro" || !href) {
    return <span className="text-xs text-faint">{t("observatory.p2p.offer.mostroClient", { defaultValue: "Open in any Mostro client" })}</span>;
  }
  const tor = /\.onion\//.test(href);
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-foreground hover:text-bitcoin focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin"
    >
      {tor ? t("observatory.p2p.offer.openTor", { defaultValue: "Open (Tor)" }) : t("observatory.p2p.offer.open", { defaultValue: "Open" })}
      <ExternalLink size={12} aria-hidden="true" className="text-faint" />
    </a>
  );
}

/** Compact fact card for one offer: the wall's tooltip and sheet, and the list on phones. */
export function OfferCard({ offer, names, median, intent }: { offer: P2pOffer; names: Map<string, string>; median: number | null; intent: "buy" | "sell" }) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <VenueBadge offer={offer} names={names} />
        <PremiumValue offer={offer} median={median} intent={intent} className="text-lg leading-none" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <Amount offer={offer} />
        <span className="flex flex-col items-end gap-1 text-xs text-faint">
          <LayerLabel offer={offer} />
          <EscrowLabel offer={offer} />
        </span>
      </div>
      <Methods methods={offer.methods} />
    </div>
  );
}
