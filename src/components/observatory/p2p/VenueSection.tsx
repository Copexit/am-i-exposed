"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info } from "lucide-react";
import type { VenueHost } from "@/lib/observatory/p2p/types";
import { fmtPremium, fmtSatsBtc } from "@/lib/observatory/p2p/p2p-format";
import { hostColorVar, venueFgVar } from "@/lib/observatory/p2p/venue-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import { DASH, FADE } from "./p2p-ui";

interface Props {
  hosts: VenueHost[];
  isUmbrel: boolean;
  /** Hash `coordinator`: a RoboSats key or a Mostro pubkey to scroll to and ring. */
  highlight: string | null;
}

const pct = (v: number | null, locale: string) => (v === null ? DASH : `${v.toLocaleString(locale, { maximumFractionDigits: 3 })}%`);
const btc = (v: number | null, locale: string) => (v === null ? DASH : `${fmtBtc(v, locale)} BTC`);
const sats = (v: number | null, locale: string) => (v === null ? DASH : `${fmtSatsBtc(v, locale)} BTC`);

function useStatusLabel() {
  const { t } = useTranslation();
  return (s: VenueHost["status"]) =>
    s === "up" ? t("observatory.p2p.venues.up", { defaultValue: "Online" })
    : s === "down" ? t("observatory.p2p.venues.down", { defaultValue: "Not answering" })
    : t("observatory.p2p.venues.torOnly", { defaultValue: "Tor only" });
}

const DOT: Record<VenueHost["status"], string> = { up: "bg-success", down: "bg-severity-critical/80", unknown: "bg-faint" };

function StatusPill({ status }: { status: VenueHost["status"] }) {
  const label = useStatusLabel();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted whitespace-nowrap">
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[status]}`} />
      {label(status)}
    </span>
  );
}

function useHighlight(active: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => ref.current?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" }));
  }, [active]);
  return ref;
}

function VenueHeader({ name, color, explainer, aside }: { name: string; color: string; explainer: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="space-y-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: color }} />
          {name}
        </h3>
        <p className="text-sm text-muted text-pretty">{explainer}</p>
      </div>
      {aside}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-faint leading-tight">{label}</dt>
      <dd className="num truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function RobosatsCoordinatorCard({ host, highlighted }: { host: VenueHost; highlighted: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const ref = useHighlight(highlighted);
  const torOnly = host.status === "unknown";
  return (
    <article
      ref={(el) => { ref.current = el; }}
      id={`p2p-host-${host.key}`}
      data-testid={`p2p-coord-${host.key}`}
      data-highlighted={highlighted || undefined}
      className={`relative overflow-hidden rounded-xl border border-hairline bg-surface-1 p-4 pl-5 space-y-3 transition-shadow ${highlighted ? "ring-2 ring-bitcoin/70" : ""} ${FADE}`}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: hostColorVar("robosats", host.key) }} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-foreground">{host.name}</h4>
          <p className="num text-xs text-faint">{host.version ? `v${host.version}` : DASH}</p>
        </div>
        <StatusPill status={host.status} />
      </div>
      {host.notice && (
        <p title={host.notice} className={`flex items-start gap-1.5 text-xs ${host.noticeWarn ? "text-warning" : "text-muted"}`}>
          {host.noticeWarn ? <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" /> : <Info size={12} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />}
          <span className="line-clamp-2">{host.notice}</span>
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Fact label={t("observatory.p2p.venues.inBook", { defaultValue: "Offers in the book" })} value={fmtCount(host.inBook, locale)} />
        {!torOnly && (
          <>
            <Fact label={t("observatory.p2p.venues.fees", { defaultValue: "Maker / taker fee" })} value={`${pct(host.makerFeePct, locale)} / ${pct(host.takerFeePct, locale)}`} />
            <Fact label={t("observatory.p2p.venues.bond", { defaultValue: "Bond" })} value={pct(host.bondPct, locale)} />
            <Fact label={t("observatory.p2p.venues.limits", { defaultValue: "Order size" })} value={`${sats(host.minSats, locale)} - ${sats(host.maxSats, locale)}`.replace(/ BTC - /, " - ")} />
            <Fact label={t("observatory.p2p.venues.volume24h", { defaultValue: "Volume 24 h" })} value={btc(host.volume24hBtc, locale)} />
            <Fact label={t("observatory.p2p.venues.lifetime", { defaultValue: "Lifetime volume" })} value={btc(host.lifetimeBtc, locale)} />
            <Fact label={t("observatory.p2p.venues.robots", { defaultValue: "Robots today" })} value={host.robotsToday === null ? DASH : fmtCount(host.robotsToday, locale)} />
            <Fact label={t("observatory.p2p.venues.premium24h", { defaultValue: "Premium 24 h" })} value={host.premium24h === null ? DASH : fmtPremium(host.premium24h, locale)} />
          </>
        )}
      </dl>
      {torOnly && <p className="text-xs text-faint">{t("observatory.p2p.venues.selfHosted", { defaultValue: "Full stats on a self-hosted node" })}</p>}
    </article>
  );
}

export function MostroInstances({ hosts, highlight }: { hosts: VenueHost[]; highlight: string | null }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const sorted = [...hosts].sort((a, b) => b.inBook - a.inBook || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const active = sorted.filter((h) => h.status === "up");
  const inactive = sorted.filter((h) => h.status !== "up");
  const [showInactive, setShowInactive] = useState(() => inactive.some((h) => h.key === highlight));
  const rows = showInactive ? [...active, ...inactive] : active;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "narrow" });
  const newest = Math.max(0, ...hosts.map((h) => h.lastSeen ?? 0));
  const seen = (s: number | null) => {
    if (s === null) return DASH;
    // Relative to the newest info event in the snapshot, so it never depends on the visitor clock.
    const m = Math.max(0, Math.floor((newest - s) / 60));
    return m < 60 ? rtf.format(-Math.max(1, m), "minute") : m < 1440 ? rtf.format(-Math.floor(m / 60), "hour") : rtf.format(-Math.floor(m / 1440), "day");
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-hairline">
        <table className="w-full text-sm sm:min-w-[640px]" data-testid="p2p-mostro">
          <caption className="sr-only">{t("observatory.p2p.venues.mostroCaption", { defaultValue: "Mostro instances seen on public relays" })}</caption>
          <thead className="bg-surface-inset text-left text-xs text-faint">
            <tr>
              <th scope="col" className="px-3 py-2 font-normal">{t("observatory.p2p.venues.instance", { defaultValue: "Instance" })}</th>
              <th scope="col" className="px-3 py-2 font-normal">{t("observatory.p2p.venues.status", { defaultValue: "Status" })}</th>
              <th scope="col" className="hidden px-3 py-2 font-normal sm:table-cell">{t("observatory.p2p.venues.version", { defaultValue: "Version" })}</th>
              <th scope="col" className="px-3 py-2 font-normal text-right">{t("observatory.p2p.venues.fee", { defaultValue: "Fee" })}</th>
              <th scope="col" className="hidden px-3 py-2 font-normal md:table-cell">{t("observatory.p2p.venues.limits", { defaultValue: "Order size" })}</th>
              <th scope="col" className="hidden px-3 py-2 font-normal lg:table-cell">{t("observatory.p2p.venues.currencies", { defaultValue: "Currencies" })}</th>
              <th scope="col" className="px-3 py-2 font-normal text-right">{t("observatory.p2p.venues.offers", { defaultValue: "Offers" })}</th>
              <th scope="col" className="px-3 py-2 font-normal text-right">{t("observatory.p2p.venues.lastSeen", { defaultValue: "Last seen" })}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.key} id={`p2p-host-${h.key}`} data-testid="p2p-mostro-row" className={`border-t border-hairline ${h.key === highlight ? "bg-bitcoin/10" : ""} ${h.status === "up" ? "" : "text-faint"}`}>
                <td className="max-w-[12rem] truncate px-3 py-2 text-foreground" title={h.key.slice(0, 16)}>{h.name}</td>
                <td className="px-3 py-2"><StatusPill status={h.status} /></td>
                <td className="num hidden px-3 py-2 text-muted sm:table-cell">{h.version ?? DASH}</td>
                <td className="num px-3 py-2 text-right text-muted">{pct(h.makerFeePct, locale)}</td>
                <td className="num hidden px-3 py-2 text-muted whitespace-nowrap md:table-cell">{h.minSats !== null && h.maxSats !== null ? `${fmtCount(h.minSats, locale)} - ${fmtCount(h.maxSats, locale)} sats` : DASH}</td>
                <td className="num hidden max-w-[10rem] truncate px-3 py-2 text-muted lg:table-cell" title={h.currencies?.join(", ")}>{h.currencies?.length ? h.currencies.slice(0, 4).join(" ") + (h.currencies.length > 4 ? ` +${h.currencies.length - 4}` : "") : t("observatory.p2p.venues.anyCurrency", { defaultValue: "Any" })}</td>
                <td className="num px-3 py-2 text-right text-foreground">{fmtCount(h.inBook, locale)}</td>
                <td className="num px-3 py-2 text-right text-faint whitespace-nowrap">{seen(h.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inactive.length > 0 && (
        <button
          type="button"
          onClick={() => setShowInactive((v) => !v)}
          className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm text-muted hover:text-foreground cursor-pointer"
        >
          {showInactive
            ? t("observatory.p2p.venues.hideInactive", { defaultValue: "Hide inactive" })
            : t("observatory.p2p.venues.showInactive", { defaultValue: "Show {{count}} inactive", count: inactive.length })}
        </button>
      )}
    </div>
  );
}

export function HodlhodlCard({ host }: { host: VenueHost }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  return (
    <article data-testid="p2p-hodlhodl" className="relative overflow-hidden rounded-xl border border-hairline bg-surface-1 p-4 pl-5 sm:max-w-md">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ background: venueFgVar("hodlhodl") }} />
      <div className="mb-3 flex items-start justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">HodlHodl</h4>
        <StatusPill status={host.status} />
      </div>
      <dl className="grid grid-cols-3 gap-3">
        <Fact label={t("observatory.p2p.venues.offers", { defaultValue: "Offers" })} value={fmtCount(host.inBook, locale)} />
        <Fact label={t("observatory.p2p.venues.currencies", { defaultValue: "Currencies" })} value={fmtCount(host.currencies?.length ?? 0, locale)} />
        <Fact label={t("observatory.p2p.venues.typicalFee", { defaultValue: "Typical fee" })} value={pct(host.makerFeePct, locale)} />
      </dl>
    </article>
  );
}

/** RoboSats coordinator cards, the Mostro instance table and the HodlHodl card, each with its escrow model. */
export function VenueSection({ hosts, isUmbrel, highlight }: Props) {
  const { t } = useTranslation();
  const robo = hosts.filter((h) => h.venue === "robosats");
  const mostro = hosts.filter((h) => h.venue === "mostro");
  const hodl = hosts.find((h) => h.venue === "hodlhodl");
  const up = robo.filter((h) => h.status === "up").length;
  const full = robo.filter((h) => h.status !== "unknown").sort((a, b) => b.inBook - a.inBook);
  const torOnly = robo.filter((h) => h.status === "unknown").sort((a, b) => b.inBook - a.inBook);

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <VenueHeader
          name="RoboSats"
          color={venueFgVar("robosats")}
          explainer={t("observatory.p2p.venues.robosatsExplainer", { defaultValue: "Lightning hold invoices and fidelity bonds; a federation of independent coordinators." })}
          aside={!isUmbrel && <p className="text-xs text-faint">{t("observatory.p2p.venues.torNote", { defaultValue: "{{up}} of {{count}} reachable from the public site", up, count: robo.length })}</p>}
        />
        <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {full.map((h) => <RobosatsCoordinatorCard key={h.key} host={h} highlighted={highlight === h.key} />)}
        </div>
        {torOnly.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-faint">{t("observatory.p2p.venues.torOnlyLead", { defaultValue: "Reachable only through Tor: full stats on a self-hosted node. Offers in the book come from their signed Nostr orders." })}</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {torOnly.map((h) => (
                <li
                  key={h.key}
                  id={`p2p-host-${h.key}`}
                  data-testid={`p2p-coord-${h.key}`}
                  data-highlighted={highlight === h.key || undefined}
                  className={`flex items-center justify-between gap-3 rounded-lg border border-hairline bg-surface-1 px-3 py-2.5 ${highlight === h.key ? "ring-2 ring-bitcoin/70" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-full" style={{ background: hostColorVar("robosats", h.key) }} />
                    <span className="truncate text-sm text-foreground">{h.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3">
                    <span className="num text-xs text-muted" title={t("observatory.p2p.venues.inBook", { defaultValue: "Offers in the book" })}>{t("observatory.p2p.venues.offersShort", { defaultValue: "{{count}} offers", count: h.inBook })}</span>
                    <StatusPill status={h.status} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {mostro.length > 0 && (
        <div className="space-y-4">
          <VenueHeader
            name="Mostro"
            color={venueFgVar("mostro")}
            explainer={t("observatory.p2p.venues.mostroExplainer", { defaultValue: "Lightning hold invoices coordinated over Nostr; anyone can run an instance." })}
          />
          <MostroInstances hosts={mostro} highlight={highlight} />
        </div>
      )}

      {hodl && (
        <div className="space-y-4">
          <VenueHeader
            name="HodlHodl"
            color={venueFgVar("hodlhodl")}
            explainer={t("observatory.p2p.venues.hodlhodlExplainer", { defaultValue: "On-chain 2-of-3 multisig escrow; the platform never holds the coins alone." })}
          />
          <HodlhodlCard host={hodl} />
        </div>
      )}
    </div>
  );
}
