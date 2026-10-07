"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Map as MapIcon, Table2 } from "lucide-react";
import { useCoordinatorsStatus, useFlowMap } from "@/hooks/useWabisator";
import { useObsState } from "@/hooks/useObsState";
import { REPLAY_SECONDS, buildScene, layoutStars, replayProgress, replayTime, type Scene, type SceneStatus, type SkyEvent } from "@/lib/observatory/sky-model";
import type { Period } from "@/lib/observatory/wabisator-client";
import type { ObsState } from "@/lib/observatory/obs-hash";
import type { FlowMap } from "@/lib/observatory/wabisator-types";
import { useTheme } from "@/hooks/useTheme";
import { KNOWN_COORDINATORS, coordinatorColorVar, coordinatorFgVar } from "@/lib/observatory/coordinator-palette";
import { ObservatoryAttribution } from "@/components/observatory/ObservatoryAttribution";
import { ObservatoryErrorState } from "@/components/observatory/ObservatoryErrorState";
import { StatsStrip, usePeriodLabel } from "./StatsStrip";
import { TableView } from "./TableView";
import { SkyMap, skyCardClass, useMedia, useReducedMotion, useSkyClock } from "./SkyMap";
import { Timeline } from "./Timeline";
import { Ticker } from "./Ticker";
import { LiveBoard } from "./LiveBoard";
import { CoordinatorPage } from "./CoordinatorPage";
import { RemixFlows } from "./RemixFlows";
import { ObsSearch } from "./ObsSearch";

const FADE = "motion-safe:animate-[obs-fade_250ms_ease-out]";
const BONE = "rounded bg-surface-2 motion-safe:animate-pulse";
const CHIP = "inline-flex items-center gap-2 min-h-10 px-3 rounded-lg text-sm transition-colors duration-200 cursor-pointer";

/** One page section. Later tasks mount their component as `children` in place of the skeleton. */
function Section({ id, title, lead, hideTitle, describedBy, children }: { id: string; title: string; lead?: string; hideTitle?: boolean; describedBy?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} aria-describedby={describedBy} className={hideTitle ? "" : "space-y-5 pt-2"}>
      {hideTitle ? (
        <h2 id={`${id}-title`} className="sr-only">{title}</h2>
      ) : (
        <div className="space-y-1.5 max-w-2xl">
          <h2 id={`${id}-title`} className="text-xl sm:text-[22px] font-semibold tracking-tight text-foreground text-balance">{title}</h2>
          {lead && <p className="text-sm text-muted leading-relaxed">{lead}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Sticky in-page chips; highlights the section in view. `aside` sits at the right end (the search, from 1024 px). */
function SubNav({ items, aside }: { items: { id: string; label: string }[]; aside?: ReactNode }) {
  const { t } = useTranslation();
  const [active, setActive] = useState(items[0]?.id);
  const ids = items.map((i) => i.id).join(",");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const list = ids.split(",");
    // The last section may be too short to reach the observed band: at the page bottom it is the active one.
    const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
    const io = new IntersectionObserver(
      (entries) => {
        if (atBottom()) return setActive(list.at(-1));
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    for (const id of list) {
      const el = document.getElementById(id);
      if (el) io.observe(el);
    }
    const onScroll = () => { if (atBottom()) setActive(list.at(-1)); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", onScroll); };
  }, [ids]);

  return (
    <nav
      aria-label={t("observatory.wabisabi.nav.label", { defaultValue: "WabiSabi sections" })}
      className="sticky top-[var(--header-h,56px)] z-30 mb-3 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-0.5 bg-background/85 backdrop-blur border-b border-hairline"
    >
      <div className="flex items-center justify-between gap-6">
        <ul className="flex min-w-0 gap-1 overflow-x-auto no-scrollbar">
          {items.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                  document.getElementById(s.id)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
                }}
                aria-current={active === s.id ? "true" : undefined}
                className={`inline-flex items-center min-h-10 px-3 rounded-md text-sm whitespace-nowrap transition-colors duration-200 ${active === s.id ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        {aside}
      </div>
    </nav>
  );
}

// ---------- skeletons shaped like the content later tasks mount ----------

/** Where the stars will be: the stable layout of the known coordinators. */
const SKELETON_STARS = Object.entries(layoutStars([...KNOWN_COORDINATORS], {}));

function MapSkeleton({ loading }: { loading: boolean }) {
  const { t } = useTranslation();
  return (
    <div aria-hidden="true" className="absolute inset-0">
      {SKELETON_STARS.map(([key, p], i) => (
        <span
          key={key}
          className="absolute size-2.5 -translate-1/2 rounded-full opacity-40 motion-safe:animate-pulse"
          style={{
            left: `${p.x * 100}%`,
            top: `${p.y * 80}%`,
            background: coordinatorColorVar(key),
            boxShadow: `0 0 28px 6px color-mix(in srgb, ${coordinatorColorVar(key)} 30%, transparent)`,
            animationDelay: `${i * 180}ms`,
          }}
        />
      ))}
      {loading && (
        <p className="eyebrow absolute inset-x-0 top-[40%] text-center" style={{ color: "color-mix(in srgb, var(--obs-sky-fg) 55%, transparent)" }}>
          {t("observatory.wabisabi.map.loading", { defaultValue: "Loading the map" })}
        </p>
      )}
    </div>
  );
}

const TIMELINE_BARS = Array.from({ length: 48 }, (_, i) => 20 + Math.round(60 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23))));

function TimelineSkeleton() {
  return (
    <div aria-hidden="true" className="flex h-10 items-end gap-[2px]">
      {TIMELINE_BARS.map((h, i) => <span key={i} className={`flex-1 ${BONE}`} style={{ height: `${h}%` }} />)}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-xl border border-hairline bg-surface-1 p-4 space-y-3">
      {Array.from({ length: 7 }, (_, i) => <div key={i} className={`h-5 ${BONE}`} />)}
    </div>
  );
}

function LiveSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((c) => (
        <div key={c} className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2.5">
            <span className={`size-2.5 rounded-full ${BONE}`} />
            <span className={`h-4 w-28 ${BONE}`} />
            <span className={`ml-auto h-4 w-14 ${BONE}`} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[16, 20, 14].map((w) => <span key={w} className={`h-6 ${BONE}`} style={{ width: `${w * 4}px` }} />)}
          </div>
          {[0, 1].map((r) => (
            <div key={r} className="space-y-2 border-t border-hairline pt-3">
              <div className="flex gap-1">{[0, 1, 2, 3, 4].map((s) => <span key={s} className={`h-1.5 flex-1 ${BONE}`} />)}</div>
              <div className={`h-2 w-full ${BONE}`} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CoordinatorSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) p-4 sm:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <span className={`size-3 rounded-full ${BONE}`} />
        <span className={`h-6 w-40 ${BONE}`} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="space-y-2">
            <span className={`block h-3 w-16 ${BONE}`} />
            <span className={`block h-6 w-24 ${BONE}`} />
          </div>
        ))}
      </div>
      <div className={`h-48 sm:h-56 w-full ${BONE}`} />
    </div>
  );
}

/** Shaped like RemixFlows: the total, the share bar, then two columns of ranked bars. */
function FlowsSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) p-5 sm:p-8 space-y-8 sm:space-y-10">
      <div className="space-y-5">
        <div className="space-y-2.5">
          <span className={`block h-3 w-44 ${BONE}`} />
          <span className={`block h-10 w-56 ${BONE}`} />
          <span className={`block h-4 w-full max-w-xl ${BONE}`} />
        </div>
        <div className="flex h-3 gap-[3px]">
          <span className={`h-full w-[30%] !rounded-l-full ${BONE}`} />
          <span className={`h-full flex-1 !rounded-r-full ${BONE}`} />
        </div>
      </div>
      <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
        {[0, 1].map((c) => (
          <div key={c} className="space-y-4">
            <span className={`block h-3 w-32 ${BONE}`} />
            {[100, 72, 50, 34].map((w) => (
              <div key={w} className="space-y-1.5">
                <div className="flex justify-between gap-3"><span className={`h-4 w-36 ${BONE}`} /><span className={`h-4 w-16 ${BONE}`} /></div>
                <div className={`h-1.5 !rounded-full ${BONE}`} style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- the map view ----------

/** A playhead request from the search: applied once (also when the map mounts for it), then cleared. */
type Seek = { t: number; lead: number };

/**
 * Map, timeline and ticker around one replay clock. Its own component so the clock's 10 Hz
 * progress re-renders only this, not the whole tab.
 */
function SkyView({ scene, period, tx, coordinator, setObs, seek, onSeeked }: { scene: Scene | null; period: Period; tx: string | null; coordinator: string | null; setObs: (patch: Partial<ObsState>) => void; seek: Seek | null; onSeeked: () => void }) {
  const { theme } = useTheme();
  const reduced = useReducedMotion();
  const wide = useMedia("(min-width: 1024px)");
  const sky = useSkyClock(period, reduced);
  // A search moves the playhead: to a date, or just before a found CoinJoin so its pulse plays.
  const { scrub } = sky;
  useEffect(() => {
    if (!seek || !scene) return;
    scrub(Math.max(0, replayProgress(seek.t, scene) - seek.lead / REPLAY_SECONDS[period]));
    onSeeked();
  }, [seek, scene, scrub, period, onSeeked]);
  const selectStar = useCallback((key: string) => {
    setObs({ coordinator: key });
    requestAnimationFrame(() => document.getElementById("obs-coordinator")?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }));
  }, [setObs, reduced]);
  const selectEvent = useCallback((next: string | null) => setObs({ tx: next }), [setObs]);
  const ticker = (tone: "sky" | "page") =>
    scene && (
      <Ticker
        scene={scene}
        time={sky.live ? Infinity : replayTime(sky.progress, scene)}
        highlightTx={tx}
        onSelect={selectEvent}
        tone={tone}
        withDate={period !== 1}
        reduced={reduced}
      />
    );

  return (
    // `contents`: map, timeline and ticker are items of the tab's map column, so its one view toggle can sit between them.
    <div className="contents">
      {scene ? (
        <SkyMap
          scene={scene}
          period={period}
          clock={sky.clock}
          highlightTx={tx}
          selected={coordinator}
          onSelectStar={selectStar}
          onSelectEvent={selectEvent}
          aside={wide ? ticker("sky") : undefined}
        >
          <StatsStrip totals={scene.totals} period={period} />
        </SkyMap>
      ) : (
        <div className={skyCardClass(theme)}>
          <div className="obs-sky-scope absolute inset-0">
            <MapSkeleton loading />
            <div className="absolute inset-x-0 bottom-0 p-3 sm:p-5 bg-gradient-to-t from-(--obs-sky) to-transparent">
              <StatsStrip totals={null} period={period} />
            </div>
          </div>
        </div>
      )}
      {scene ? (
        <Timeline
          scene={scene}
          period={period}
          progress={sky.progress}
          playing={sky.playing}
          live={sky.live}
          onScrub={sky.scrub}
          onTogglePlay={sky.toggle}
          onPeriod={(p) => setObs({ period: p, tx: null })}
        />
      ) : (
        <TimelineSkeleton />
      )}
      {!wide && <div className="order-2">{ticker("page")}</div>}
    </div>
  );
}

// ---------- the tab ----------

/** Focuses an element that may take a few frames to appear (about half a second at most). */
function focusWhenReady(id: string, frames = 30) {
  const el = document.getElementById(id);
  if (el) el.focus({ preventScroll: true });
  else if (frames > 0) requestAnimationFrame(() => focusWhenReady(id, frames - 1));
}

/**
 * The WabiSabi tab: header with search, sticky sub-nav, then map, live rounds, coordinator and
 * flows sections, each a slot the later components mount into without re-layout.
 */
export function WabiSabiTab() {
  const { t, i18n } = useTranslation();
  const [obs, setObs] = useObsState();
  const flow = useFlowMap(obs.period);
  const status = useCoordinatorsStatus();
  // The 10 s status poll only changes the scene when a name or online state does.
  const statusKey = status.data?.Coordinators.map((c) => `${c.Key}\t${c.Name}\t${c.Status}`).join("\n") ?? "";
  const sceneStatus: SceneStatus | null = useMemo(
    () => (statusKey ? { Coordinators: statusKey.split("\n").map((l) => { const [Key = "", Name = "", Status = ""] = l.split("\t"); return { Key, Name, Status }; }) } : null),
    [statusKey],
  );
  // The last good flow-map survives a period switch, so the coordinator page and chooser stay mounted
  // (chart range, rounds page) while the next period loads; the map and stats show their loading state.
  const [lastFlow, setLastFlow] = useState<FlowMap | null>(null);
  if (flow.data && flow.data !== lastFlow) setLastFlow(flow.data);
  const keptFlow = flow.data ?? lastFlow;
  const keptScene: Scene | null = useMemo(() => (keptFlow ? buildScene(keptFlow, sceneStatus) : null), [keptFlow, sceneStatus]);
  const scene = flow.data ? keptScene : null;
  const periodLabel = usePeriodLabel(obs.period);
  const flowFailed = !flow.data && !!flow.error;
  const table = obs.view === "table";
  const nav = [
    { id: "obs-map", label: t("observatory.wabisabi.nav.map", { defaultValue: "Map" }) },
    { id: "obs-live", label: t("observatory.wabisabi.nav.live", { defaultValue: "Live rounds" }) },
    { id: "obs-coordinator", label: t("observatory.wabisabi.nav.coordinators", { defaultValue: "Coordinators" }) },
    { id: "obs-flows", label: t("observatory.wabisabi.nav.flows", { defaultValue: "Flows" }) },
  ];

  const viewToggle = (
    <div role="group" aria-label={t("observatory.wabisabi.view.label", { defaultValue: "View" })} className="inline-flex gap-1 p-1 rounded-lg bg-surface-inset border border-card-border">
      {([["map", MapIcon, t("observatory.wabisabi.view.map", { defaultValue: "Map" })], ["table", Table2, t("observatory.wabisabi.view.table", { defaultValue: "Table" })]] as const).map(([id, Icon, label]) => (
        <button
          key={id}
          type="button"
          aria-pressed={obs.view === id}
          onClick={() => setObs({ view: id })}
          className={`${CHIP} ${obs.view === id ? "bg-surface-elevated text-foreground shadow-sm ring-1 ring-hairline-strong" : "text-muted hover:text-foreground"}`}
        >
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );

  const openCoordinator = useCallback((key: string) => {
    setObs({ coordinator: key });
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => document.getElementById("obs-coordinator")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }));
  }, [setObs]);

  // Search: highlight a found CoinJoin on the map and ticker, or move the playhead to a date.
  const [seek, setSeek] = useState<Seek | null>(null);
  const onSeeked = useCallback(() => setSeek(null), []);
  const showMap = useCallback((then?: () => void) => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      document.getElementById("obs-map")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      then?.();
    });
  }, []);
  const onFound = useCallback((e: SkyEvent) => {
    setObs(table ? { tx: e.txid, view: "map" } : { tx: e.txid });
    setSeek({ t: e.t, lead: 1.5 });
    // Hand focus to the map's pinned card once it has rendered (it needs the map's layout).
    showMap(() => focusWhenReady("obs-event-card"));
  }, [setObs, showMap, table]);
  const onJumpTo = useCallback((t: number) => {
    if (table) setObs({ view: "map" });
    setSeek({ t, lead: 0 });
    showMap();
  }, [setObs, showMap, table]);

  const coordinators = keptScene ? [...keptScene.stars].sort((a, b) => b.volume - a.volume || a.name.localeCompare(b.name)) : null;
  // Until the coordinators load the key may be valid; afterwards an unknown key is dropped quietly.
  const dataLoaded = !!keptScene && !!status.data;
  const coordinatorKnown = !!obs.coordinator && !!coordinators?.some((s) => s.key === obs.coordinator);
  useEffect(() => {
    if (dataLoaded && obs.coordinator && !coordinatorKnown) setObs({ coordinator: null });
  }, [dataLoaded, obs.coordinator, coordinatorKnown, setObs]);
  const coordinatorStatus = status.data?.Coordinators.find((c) => c.Key === obs.coordinator) ?? null;
  const closeCoordinator = useCallback(() => {
    const key = obs.coordinator;
    setObs({ coordinator: null });
    // The inline page's close button disappears; hand focus to the chip unless the sheet already restored it.
    requestAnimationFrame(() => { if (document.activeElement === document.body) document.getElementById(`obs-chip-${key}`)?.focus(); });
  }, [obs.coordinator, setObs]);

  // One search box: in the sticky nav from 1024 px, under the caption below that.
  const wide = useMedia("(min-width: 1024px)");
  const search = <ObsSearch scene={scene} period={obs.period} onFound={onFound} onJumpTo={onJumpTo} onSwitchPeriod={(p) => setObs({ period: p, tx: null })} />;

  return (
    <div className="space-y-10 sm:space-y-14">
      <header className="mb-3 flex flex-col gap-3">
        <p id="obs-map-caption" className="text-sm leading-relaxed text-muted text-pretty">
          <span className="eyebrow mr-2 inline-flex items-center gap-2 !text-foreground">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-success motion-safe:animate-pulse" />
            {t("observatory.wabisabi.header.eyebrow", { defaultValue: "WabiSabi, live" })}
          </span>
          {t("observatory.wabisabi.header.lead", {
            defaultValue: "Every CoinJoin of the last {{period}} on the public WabiSabi coordinators, replayed and then followed live.",
            period: periodLabel,
          })}
          <span className="sr-only">
            {" "}
            {t("observatory.wabisabi.map.lead", { defaultValue: "One star per coordinator, sized by volume. Pulses are CoinJoins; particles are fresh and remixed coins." })}
          </span>
        </p>
        {!wide && search}
      </header>

      <SubNav items={nav} aside={wide ? <div className="w-[360px] shrink-0">{search}</div> : undefined} />

      <Section id="obs-map" title={t("observatory.wabisabi.map.title", { defaultValue: "The CoinJoin map" })} hideTitle describedBy="obs-map-caption">
        <div className="flex flex-col gap-4 sm:gap-5">
          {flowFailed ? (
            <ObservatoryErrorState source="wabisator" onRetry={flow.refresh} locale={i18n.language || "en"} />
          ) : table ? (
            <div className={`space-y-6 ${FADE}`}>
              <StatsStrip totals={scene?.totals ?? null} period={obs.period} />
              {scene ? <TableView scene={scene} /> : <TableSkeleton />}
            </div>
          ) : (
            <SkyView scene={scene} period={obs.period} tx={obs.tx} coordinator={obs.coordinator} setObs={setObs} seek={seek} onSeeked={onSeeked} />
          )}
          {/* One slot for the toggle whatever the view or loading state, so its buttons (and focus) persist:
              under the timeline on the map, above the tables in table view. */}
          <div className={`flex justify-end ${table ? "order-first" : "order-1"} ${flowFailed ? "hidden" : ""}`}>{viewToggle}</div>
        </div>
      </Section>

      <Section
        id="obs-live"
        title={t("observatory.wabisabi.live.title", { defaultValue: "Live rounds" })}
        lead={t("observatory.wabisabi.live.lead", { defaultValue: "Rounds open right now on each coordinator, with their phase and inputs." })}
      >
        <LiveBoard status={status} onOpenCoordinator={openCoordinator} skeleton={<LiveSkeleton />} />
      </Section>

      <Section
        id="obs-coordinator"
        title={t("observatory.wabisabi.coordinator.title", { defaultValue: "Coordinators" })}
        lead={t("observatory.wabisabi.coordinator.lead", { defaultValue: "Pick a coordinator for its history, rounds and remix partners." })}
      >
        <div className="flex flex-wrap gap-2">
          {coordinators
            ? coordinators.map((s) => (
                <button
                  key={s.key}
                  id={`obs-chip-${s.key}`}
                  type="button"
                  aria-pressed={obs.coordinator === s.key}
                  onClick={() => setObs({ coordinator: obs.coordinator === s.key ? null : s.key })}
                  className={`${CHIP} border ${FADE} ${obs.coordinator === s.key ? "border-hairline-strong bg-surface-2 text-foreground" : "border-hairline text-muted hover:text-foreground hover:border-hairline-strong"} ${s.online ? "" : "opacity-60"}`}
                >
                  <span aria-hidden="true" className="size-2 rounded-full" style={{ background: coordinatorFgVar(s.key) }} />
                  {s.name}
                </button>
              ))
            : [96, 120, 84, 132, 100].map((w) => <span key={w} aria-hidden="true" className={`h-10 rounded-lg ${BONE}`} style={{ width: `${w}px` }} />)}
        </div>
        {obs.coordinator && keptScene && keptFlow && coordinatorKnown ? (
          <CoordinatorPage key={obs.coordinator} coordinatorKey={obs.coordinator} scene={keptScene} flow={keptFlow} status={coordinatorStatus} onClose={closeCoordinator} stale={!flow.data && !flow.error} />
        ) : (
          obs.coordinator && !dataLoaded && <CoordinatorSkeleton />
        )}
      </Section>

      <Section
        id="obs-flows"
        title={t("observatory.wabisabi.flows.title", { defaultValue: "Remix flows" })}
        lead={t("observatory.wabisabi.flows.lead", { defaultValue: "Where remixed coins went in the last {{period}}: on to another coordinator, or back into the same one.", period: periodLabel })}
      >
        {scene ? <RemixFlows scene={scene} onOpenCoordinator={openCoordinator} /> : flowFailed ? null : <FlowsSkeleton />}
      </Section>

      <ObservatoryAttribution lastUpdatedAt={flow.updatedAt} locale={i18n.language || "en"} />
    </div>
  );
}
