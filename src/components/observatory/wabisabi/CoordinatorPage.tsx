"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, X } from "lucide-react";
import { useVolumeHistory } from "@/hooks/useWabisator";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { coordinatorKpis, largestCoinjoins, remixPartners, volumeSeries, type HistoryRange } from "@/lib/observatory/coordinator-page";
import { coordinatorFgVar } from "@/lib/observatory/coordinator-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import type { Flow, Scene, Star } from "@/lib/observatory/sky-model";
import type { Period } from "@/lib/observatory/wabisator-client";
import type { FlowMap, StatusCoordinator } from "@/lib/observatory/wabisator-types";
import { usePeriodLabel } from "./StatsStrip";
import { useMedia } from "./SkyMap";
import { VolumeHistoryChart } from "./VolumeHistoryChart";
import { RoundsTable, shortTxid } from "./RoundsTable";

export interface CoordinatorPageProps {
  coordinatorKey: string;
  scene: Scene;
  flow: FlowMap;
  /** The tab's coordinators-status entry (fees, website); null until it loads or when absent. */
  status: StatusCoordinator | null;
  onClose: () => void;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin";
const BONE = "rounded bg-surface-2 motion-safe:animate-pulse";
const FADE = "motion-safe:animate-[obs-fade_300ms_ease-out]";
const RANGES: HistoryRange[] = ["30d", "90d", "1y", "all"];

/**
 * One coordinator, read like a data story: header, eight KPIs, the daily volume history,
 * the period's largest CoinJoins, remix partners and the latest rounds. Inline on desktop,
 * a full-screen sheet below 640 px. Unknown keys render nothing.
 */
export function CoordinatorPage(props: CoordinatorPageProps) {
  const star = props.scene.stars.find((s) => s.key === props.coordinatorKey);
  return star ? <Page {...props} star={star} /> : null;
}

function Page({ coordinatorKey: key, scene, flow, status, onClose, star }: CoordinatorPageProps & { star: Star }) {
  const { t } = useTranslation();
  const sheet = useMedia("(max-width: 639px)");
  const titleId = `obs-coord-${key}-title`;
  const color = coordinatorFgVar(key);

  const close = (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("observatory.wabisabi.coord.close", { defaultValue: "Close" })}
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground cursor-pointer ${FOCUS}`}
    >
      <X size={18} aria-hidden="true" />
    </button>
  );
  const body = <Body coordinatorKey={key} scene={scene} flow={flow} status={status} star={star} titleId={titleId} color={color} close={sheet ? null : close} />;

  return sheet ? (
    <Sheet titleId={titleId} name={star.name} color={color} onClose={onClose} close={close}>{body}</Sheet>
  ) : (
    <article
      aria-labelledby={titleId}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
      className={`relative overflow-hidden rounded-2xl border border-hairline bg-surface-1 shadow-(--shadow-card) ${FADE}`}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px]" style={{ background: color }} />
      <span aria-hidden="true" className="pointer-events-none absolute -left-24 -top-32 size-96 rounded-full opacity-[0.07] blur-3xl" style={{ background: color }} />
      {body}
    </article>
  );
}

/** Mobile: full screen above everything, sticky title bar, Escape closes, focus trapped and restored. */
function Sheet({ titleId, name, color, onClose, close, children }: { titleId: string; name: string; color: string; onClose: () => void; close: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useFocusTrap(ref, true);
  // Once per open: the parent re-renders on every poll and must not steal focus back.
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[data-sheet-close] button")?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, []);

  return createPortal(
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${titleId}-bar`} className={`fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-background ${FADE}`}>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-hairline bg-background/90 py-1.5 pl-4 pr-2 backdrop-blur">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
        <p id={`${titleId}-bar`} className="min-w-0 flex-1 text-sm font-semibold text-foreground text-balance">{name}</p>
        <span data-sheet-close>{close}</span>
      </div>
      <span aria-hidden="true" className="block h-[3px]" style={{ background: color }} />
      {children}
    </div>,
    document.body,
  );
}

function Body({ coordinatorKey: key, scene, flow, status, star, titleId, color, close }: Omit<CoordinatorPageProps, "onClose"> & { star: Star; titleId: string; color: string; close: ReactNode }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const history = useVolumeHistory();
  const [range, setRange] = useState<HistoryRange>("1y");
  const period = Math.round((scene.until - scene.since) / 86_400) as Period;
  const periodLabel = usePeriodLabel(period);

  const kpis = useMemo(() => coordinatorKpis(key, flow, history.data), [key, flow, history.data]);
  const largest = useMemo(() => largestCoinjoins(key, flow), [key, flow]);
  const partners = useMemo(() => remixPartners(key, flow), [key, flow]);
  const today = history.data?.UpdatedAt.slice(0, 10) ?? "";
  const series = useMemo(() => (history.data ? volumeSeries(key, history.data, range, today) : null), [key, history.data, range, today]);
  const names = useMemo(() => new Map(scene.stars.map((s) => [s.key, s.name])), [scene.stars]);

  const share = scene.totals.Volume > 0 ? kpis.volume / scene.totals.Volume : 0;
  const day = (iso: string) => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(Date.parse(`${iso}T00:00:00Z`));
  const fees = status?.Fees && status.Fees !== "N/A" ? status.Fees : null;
  const rangeLabel: Record<HistoryRange, string> = {
    "30d": t("observatory.wabisabi.coord.range.30d", { defaultValue: "30 d" }),
    "90d": t("observatory.wabisabi.coord.range.90d", { defaultValue: "90 d" }),
    "1y": t("observatory.wabisabi.coord.range.1y", { defaultValue: "1 y" }),
    all: t("observatory.wabisabi.coord.range.all", { defaultValue: "All" }),
  };

  return (
    <div className="relative space-y-10 p-4 pb-8 sm:space-y-12 sm:p-8">
      {/* ---------- header ---------- */}
      <header className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-3">
            <p className="eyebrow flex items-center gap-2">
              <span aria-hidden="true" className={`size-2 rounded-full ${star.online ? "bg-success" : "bg-faint"}`} />
              {star.online
                ? t("observatory.wabisabi.online", { defaultValue: "Online" })
                : t("observatory.wabisabi.offline", { defaultValue: "Offline" })}
            </p>
            <h3 id={titleId} className="text-3xl font-semibold tracking-tight text-foreground text-balance sm:text-[42px] sm:leading-[1.05]">{star.name}</h3>
          </div>
          {close}
        </div>
        <p className="max-w-3xl text-base leading-relaxed text-muted text-pretty sm:text-lg">
          {kpis.coinjoins > 0
            ? t("observatory.wabisabi.coord.lead", {
                defaultValue: "{{volume}} BTC across {{coinjoinsFormatted}} CoinJoins in the last {{period}}, {{share}} of all WabiSabi volume tracked.",
                volume: fmtBtc(kpis.volume, locale),
                count: kpis.coinjoins,
                coinjoinsFormatted: fmtCount(kpis.coinjoins, locale),
                // Keep "7 d" together when the sentence wraps.
                period: periodLabel.replace(" ", "\u00a0"),
                share: share.toLocaleString(locale, { style: "percent", maximumFractionDigits: share < 0.01 ? 1 : 0 }),
              })
            : t("observatory.wabisabi.coord.leadIdle", { defaultValue: "No CoinJoins in the last {{period}}.", period: periodLabel })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {fees && (
            <span className="inline-flex min-h-8 items-baseline gap-1.5 rounded-md border border-hairline bg-surface-inset px-2.5 py-1 text-xs">
              <span className="text-muted">{t("observatory.wabisabi.rule.fees", { defaultValue: "Fees" })}</span>
              <span className="text-foreground">{fees}</span>
            </span>
          )}
          {status?.ReadMore && (
            <a
              href={status.ReadMore}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-10 items-center gap-1 rounded-md px-2 text-sm text-muted transition-colors duration-200 hover:text-foreground ${FOCUS}`}
            >
              {t("observatory.wabisabi.live.readMore", { defaultValue: "Website" })}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </div>
      </header>

      {/* ---------- KPIs ---------- */}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-hairline bg-hairline lg:grid-cols-4">
        <Kpi id="volume" label={t("observatory.wabisabi.coord.kpi.volume", { defaultValue: "Volume" })} value={fmtBtc(kpis.volume, locale)} unit="BTC"
          caption={t("observatory.wabisabi.coord.kpi.volumeCaption", { defaultValue: "Last {{period}}", period: periodLabel })} />
        <Kpi id="coinjoins" label={t("observatory.wabisabi.stats.coinjoins", { defaultValue: "CoinJoins" })} value={fmtCount(kpis.coinjoins, locale)}
          caption={kpis.coinjoins > 0 ? t("observatory.wabisabi.coord.kpi.coinjoinsCaption", { defaultValue: "{{avg}} BTC on average", avg: fmtBtc(kpis.volume / kpis.coinjoins, locale) }) : null} />
        <Kpi id="fresh" label={t("observatory.wabisabi.stats.fresh", { defaultValue: "Fresh bitcoin" })} value={fmtBtc(kpis.freshBtc, locale)} unit="BTC"
          caption={t("observatory.wabisabi.coord.kpi.freshCaption", { defaultValue: "Coins mixing for the first time" })} />
        <Kpi id="anonset" label={t("observatory.wabisabi.coord.kpi.anonset", { defaultValue: "Average anonset" })}
          value={kpis.avgAnonset == null ? "0" : kpis.avgAnonset.toLocaleString(locale, { maximumFractionDigits: 1 })}
          caption={t("observatory.wabisabi.coord.kpi.anonsetCaption", { defaultValue: "Outputs, weighted by volume" })} />
        <Kpi id="remixIn" label={t("observatory.wabisabi.map.remixIn", { defaultValue: "Remix in" })} value={fmtBtc(kpis.remixIn, locale)} unit="BTC"
          caption={t("observatory.wabisabi.coord.kpi.remixInCaption", { defaultValue: "From other coordinators" })} />
        <Kpi id="remixOut" label={t("observatory.wabisabi.map.remixOut", { defaultValue: "Remix out" })} value={fmtBtc(kpis.remixOut, locale)} unit="BTC"
          caption={t("observatory.wabisabi.coord.kpi.remixOutCaption", { defaultValue: "To other coordinators" })} />
        <Kpi id="internal" label={t("observatory.wabisabi.coord.kpi.internal", { defaultValue: "Internal remix" })} value={fmtBtc(kpis.internalRemix, locale)} unit="BTC"
          caption={t("observatory.wabisabi.coord.kpi.internalCaption", { defaultValue: "Remixed on this coordinator" })} />
        <Kpi id="allTime" label={t("observatory.wabisabi.coord.kpi.allTime", { defaultValue: "All-time volume" })}
          value={history.data ? fmtBtc(kpis.allTimeVolume ?? 0, locale) : null} unit="BTC"
          caption={kpis.ath ? t("observatory.wabisabi.coord.kpi.athCaption", { defaultValue: "Record day {{date}}, {{volume}} BTC", date: day(kpis.ath.date), volume: fmtBtc(kpis.ath.volume, locale) }) : null}
          accent={color} />
      </dl>

      {/* ---------- volume history ---------- */}
      <Block
        title={t("observatory.wabisabi.coord.history", { defaultValue: "Daily volume" })}
        lead={t("observatory.wabisabi.coord.historyLead", { defaultValue: "BTC per UTC day. Hover, tap or use the arrow keys for each day." })}
        action={
          <div role="group" aria-label={t("observatory.wabisabi.coord.range.label", { defaultValue: "Range" })} className="inline-flex gap-1 rounded-lg border border-card-border bg-surface-inset p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={range === r}
                onClick={() => setRange(r)}
                className={`num inline-flex min-h-10 items-center rounded-md px-3 text-sm transition-colors duration-200 cursor-pointer ${FOCUS} ${range === r ? "bg-surface-elevated text-foreground shadow-sm ring-1 ring-hairline-strong" : "text-muted hover:text-foreground"}`}
              >
                {rangeLabel[r]}
              </button>
            ))}
          </div>
        }
      >
        {series ? (
          <div className={FADE}>
            <VolumeHistoryChart
              points={series}
              ath={kpis.ath}
              color={color}
              height={280}
              label={t("observatory.wabisabi.coord.chartLabel", { defaultValue: "Daily volume of {{name}}, {{range}}", name: star.name, range: rangeLabel[range] })}
            />
          </div>
        ) : history.error ? (
          <p className="grid h-[280px] place-items-center rounded-lg border border-dashed border-hairline text-sm text-muted">
            {t("observatory.errors.unreachable", { defaultValue: "Live data is not available right now." })}
          </p>
        ) : (
          <div aria-hidden="true" className={`h-[280px] w-full ${BONE}`} />
        )}
      </Block>

      {/* ---------- largest and partners ---------- */}
      <div className="grid gap-10 sm:gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
        <Block
          title={t("observatory.wabisabi.coord.largest", { defaultValue: "Largest CoinJoins" })}
          lead={t("observatory.wabisabi.coord.largestLead", { defaultValue: "The biggest of the last {{period}}, by volume.", period: periodLabel })}
        >
          <Largest coinjoins={largest} color={color} period={period} />
        </Block>
        <Block
          title={t("observatory.wabisabi.coord.partners", { defaultValue: "Remix partners" })}
          lead={t("observatory.wabisabi.coord.partnersLead", { defaultValue: "Coins that moved between this coordinator and others in the last {{period}}.", period: periodLabel })}
        >
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-1">
            <Partners label={t("observatory.wabisabi.coord.into", { defaultValue: "Coins in from" })} flows={partners.into} side="from" names={names}
              empty={t("observatory.wabisabi.coord.intoEmpty", { defaultValue: "No coins came in from other coordinators." })} />
            <Partners label={t("observatory.wabisabi.coord.outTo", { defaultValue: "Coins out to" })} flows={partners.from} side="to" names={names}
              empty={t("observatory.wabisabi.coord.outEmpty", { defaultValue: "No coins left for other coordinators." })} />
          </div>
        </Block>
      </div>

      {/* ---------- rounds ---------- */}
      <Block
        title={t("observatory.wabisabi.rounds.caption", { defaultValue: "Recent rounds" })}
        lead={t("observatory.wabisabi.coord.roundsLead", { defaultValue: "Every finished round, newest first. Refreshed each minute." })}
      >
        <RoundsTable key={key} coordinatorKey={key} />
      </Block>
    </div>
  );
}

function Block({ title, lead, action, children }: { title: string; lead?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-t border-hairline pt-5">
        <div className="max-w-xl space-y-1">
          <h4 className="text-base font-semibold tracking-tight text-foreground sm:text-lg">{title}</h4>
          {lead && <p className="text-sm leading-relaxed text-muted text-pretty">{lead}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ id, label, value, unit, caption, accent }: { id: string; label: string; value: string | null; unit?: string; caption?: string | null; accent?: string }) {
  return (
    <div data-testid={`kpi-${id}`} className="flex min-w-0 flex-col gap-2 bg-surface-1 px-4 py-4 sm:px-5 sm:py-5">
      <dt className="eyebrow !leading-tight text-balance">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1.5">
        {value != null ? (
          <span className={`flex flex-wrap items-baseline gap-x-1.5 ${FADE}`}>
            <span className="num text-2xl leading-none tracking-tight text-foreground sm:text-[28px]" style={accent ? { color: accent } : undefined}>{value}</span>
            {unit && <span className="num text-[11px] text-muted">{unit}</span>}
          </span>
        ) : (
          <span aria-hidden="true" className={`block h-7 w-28 ${BONE}`} />
        )}
        {caption ? <span className="text-xs leading-snug text-muted text-pretty">{caption}</span> : value == null ? <span aria-hidden="true" className={`block h-3 w-24 ${BONE}`} /> : null}
      </dd>
    </div>
  );
}

function Largest({ coinjoins, color, period }: { coinjoins: FlowMap["Coinjoins"]; color: string; period: Period }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  if (coinjoins.length === 0) return <p className="rounded-lg border border-dashed border-hairline p-6 text-sm text-muted">{t("observatory.wabisabi.coord.noCoinjoins", { defaultValue: "No CoinJoins in this period." })}</p>;
  const max = coinjoins[0]!.Volume || 1;
  const time = new Intl.DateTimeFormat(locale, period === 1 ? { hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const analyze = t("observatory.wabisabi.event.analyze", { defaultValue: "Analyze in am-i.exposed" });
  return (
    <ol aria-label={t("observatory.wabisabi.coord.largest", { defaultValue: "Largest CoinJoins" })} className="divide-y divide-hairline">
      {coinjoins.map((c, i) => (
        <li key={c.TxId} className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 py-2.5">
          <span className="num text-sm text-faint">{i + 1}</span>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="flex items-baseline gap-1">
                <span className="num text-base font-medium text-foreground">{fmtBtc(c.Volume, locale)}</span>
                <span className="num text-[11px] text-muted">BTC</span>
              </span>
              <span className="num text-xs text-muted">{time.format(c.Time * 1000)}</span>
            </div>
            <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(2, (c.Volume / max) * 100)}%`, background: color }} />
            </div>
            <p className="num text-xs text-muted">
              {c.Analyzed
                ? t("observatory.wabisabi.coord.cjMeta", {
                    defaultValue: "{{inputs}} in · {{outputs}} out · anonset {{anonset}}",
                    inputs: fmtCount(c.Inputs, locale),
                    outputs: fmtCount(c.Outputs, locale),
                    anonset: c.Anonset.toLocaleString(locale, { maximumFractionDigits: 1 }),
                  })
                : t("observatory.wabisabi.event.notAnalyzed", { defaultValue: "Not analysed yet" })}
            </p>
          </div>
          <a
            href={`/#tx=${c.TxId}`}
            aria-label={`${analyze}: ${shortTxid(c.TxId)}`}
            title={`${analyze}: ${c.TxId}`}
            className={`inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground ${FOCUS}`}
          >
            <ArrowUpRight size={16} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ol>
  );
}

function Partners({ label, flows, side, names, empty }: { label: string; flows: Flow[]; side: "from" | "to"; names: Map<string, string>; empty: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const max = flows[0]?.btc || 1;
  return (
    <div className="space-y-2">
      <h5 className="eyebrow">{label}</h5>
      {flows.length === 0 ? (
        <p className="py-2 text-sm text-muted">{empty}</p>
      ) : (
        <ol aria-label={label} className="space-y-3">
          {flows.map((f) => {
            const other = f[side];
            const c = coordinatorFgVar(other);
            return (
              <li key={other} className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <span aria-hidden="true" className="size-2 shrink-0 translate-y-[-1px] self-center rounded-full" style={{ background: c }} />
                  <span className="min-w-0 flex-1 text-sm text-foreground text-balance">{names.get(other) ?? other}</span>
                  <span className="num text-sm text-foreground">{fmtBtc(f.btc, locale)} <span className="text-[11px] text-muted">BTC</span></span>
                </div>
                <div className="flex items-center gap-3 pl-4">
                  <div aria-hidden="true" className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(2, (f.btc / max) * 100)}%`, background: c }} />
                  </div>
                  <span className="num shrink-0 text-[11px] text-muted">
                    {t("observatory.wabisabi.coord.coins", { defaultValue: "{{formatted}} coins", count: f.coins, formatted: fmtCount(f.coins, locale) })}
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
