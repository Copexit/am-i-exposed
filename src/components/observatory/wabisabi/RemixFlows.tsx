"use client";

import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { arcPath, chordLayout, rankFlows, ribbonPath, type ChordGroup } from "@/lib/observatory/chord";
import { coordinatorFgVar } from "@/lib/observatory/coordinator-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import type { Flow, Scene } from "@/lib/observatory/sky-model";

/** Chord radii, in viewBox units: arcs [R, R + ARC], ribbons end at R - 3, internal band inside. */
const R = 196;
const ARC = 14;
const BAND = 10;
const LABEL = 120;
const HALF = R + ARC + LABEL;
const EASE = "transition-opacity duration-300 ease-out motion-reduce:transition-none";
const FADE = "motion-safe:animate-[obs-fade_250ms_ease-out]";

function Dot({ coordKey }: { coordKey: string }) {
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ background: coordinatorFgVar(coordKey) }} />;
}

function useFormat() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  return {
    btc: (v: number) => `${fmtBtc(v, locale)} BTC`,
    coins: (n: number) => t("observatory.wabisabi.flows.coins", { count: n, formatted: fmtCount(n, locale), defaultValue: "{{formatted}} coins" }),
    pct: (v: number) => v.toLocaleString(locale, { style: "percent", maximumFractionDigits: v < 0.01 ? 2 : 1 }),
  };
}

/** The selected coordinator's in / out / internal figures, or a hint. Fixed height: nothing jumps. */
function Readout({ group, name }: { group: ChordGroup | null; name: string }) {
  const { t } = useTranslation();
  const f = useFormat();
  const rows = group && [
    { id: "in", label: t("observatory.wabisabi.flows.in", { defaultValue: "In from others" }), btc: group.inBtc, coins: group.inCoins },
    { id: "out", label: t("observatory.wabisabi.flows.out", { defaultValue: "Out to others" }), btc: group.outBtc, coins: group.outCoins },
    { id: "internal", label: t("observatory.wabisabi.flows.internal", { defaultValue: "Internal remix" }), btc: group.internalBtc, coins: group.internalCoins },
  ];
  return (
    <div aria-live="polite" data-testid="obs-flows-readout" className="min-h-[172px] rounded-xl bg-surface-inset/50 border border-hairline p-4">
      {group && rows ? (
        <div key={group.key} className={`space-y-3 ${FADE}`}>
          <p className="flex items-center gap-2 font-medium text-foreground"><Dot coordKey={group.key} />{name}</p>
          <dl className="space-y-2 text-sm">
            {rows.map((r) => (
              <div key={r.id} className="flex items-baseline justify-between gap-4">
                <dt className="text-muted">{r.label}</dt>
                <dd className="num text-right text-foreground">
                  {f.btc(r.btc)}
                  <span className="block text-xs text-faint">{f.coins(r.coins)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : (
        <p className="text-sm text-muted leading-relaxed">
          {t("observatory.wabisabi.flows.hint", { defaultValue: "Hover or focus a coordinator to trace its flows. Select it to open its page." })}
        </p>
      )}
    </div>
  );
}

/** Wide layout: the chord diagram. Pointer only; the legend beside it is the keyboard path. */
function Chord({ scene, active, onActive, onOpen, nameOf }: { scene: Scene; active: string | null; onActive: (k: string | null) => void; onOpen: (k: string) => void; nameOf: (k: string) => string }) {
  const remixed = scene.totals.CrossRemixBtc + scene.totals.InternalRemixBtc;
  const stayed = remixed > 0 ? scene.totals.InternalRemixBtc / remixed : null;
  const { t } = useTranslation();
  const f = useFormat();
  const uid = useId().replace(/:/g, "");
  const { groups, ribbons } = useMemo(() => chordLayout(scene.flows), [scene.flows]);
  const touches = (from: string, to: string) => active === from || active === to;
  const deg = (a: number) => (a * 180) / Math.PI;
  // Turn the ring so the largest arc sits at 9 o'clock: the small ones gather at 3 o'clock, where
  // radial labels read horizontally.
  const turn = groups[0] ? (3 * Math.PI) / 2 - (groups[0].a0 + groups[0].a1) / 2 : 0;
  const summary = t("observatory.wabisabi.flows.chordAria", {
    defaultValue: "Remix flow diagram: {{coordinators}} coordinators, {{flows}} flows between them.",
    coordinators: groups.length,
    flows: ribbons.length,
  });
  return (
    <svg
      viewBox={`${-HALF} ${-HALF} ${2 * HALF} ${2 * HALF}`}
      role="img"
      aria-label={summary}
      data-testid="obs-chord"
      className="mx-auto block w-full max-w-[640px] overflow-visible"
      onPointerLeave={() => onActive(null)}
    >
      <defs>
        {ribbons.map((r, i) => {
          const m0 = (r.source.a0 + r.source.a1) / 2, m1 = (r.target.a0 + r.target.a1) / 2;
          return (
            <linearGradient key={i} id={`${uid}-g${i}`} gradientUnits="userSpaceOnUse" x1={R * Math.sin(m0)} y1={-R * Math.cos(m0)} x2={R * Math.sin(m1)} y2={-R * Math.cos(m1)}>
              <stop offset="0" stopColor={coordinatorFgVar(r.from)} />
              <stop offset="1" stopColor={coordinatorFgVar(r.to)} />
            </linearGradient>
          );
        })}
      </defs>
      <circle r={R - BAND - 6} fill="none" stroke="var(--hairline)" strokeDasharray="2 5" />
      {stayed !== null && (
        <g aria-hidden="true" className={`pointer-events-none ${EASE}`} style={{ opacity: active ? 0 : 1 }}>
          <text y={-6} textAnchor="middle" className="num fill-foreground text-[44px] font-semibold tracking-tight">{f.pct(stayed)}</text>
          <text y={24} textAnchor="middle" className="fill-muted text-[13px]">
            {t("observatory.wabisabi.flows.stayed", { defaultValue: "remixed at the same coordinator" })}
          </text>
        </g>
      )}
      <g transform={`rotate(${deg(turn)})`}>
        {ribbons.map((r, i) => (
          <path
            key={`${r.from}>${r.to}`}
            data-ribbon={`${r.from}>${r.to}`}
            d={ribbonPath(R - BAND - 3, r.source, r.target)}
            fill={`url(#${uid}-g${i})`}
            className={EASE}
            style={{ opacity: active ? (touches(r.from, r.to) ? 0.85 : 0.06) : 0.5 }}
          >
            <title>{`${nameOf(r.from)} → ${nameOf(r.to)}: ${f.btc(r.btc)}, ${f.coins(r.coins)}`}</title>
          </path>
        ))}
      {groups.map((g) => {
        const mid = (g.a0 + g.a1) / 2;
        const flip = (((mid + turn) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) > Math.PI;
        const dim = active && active !== g.key;
        const color = coordinatorFgVar(g.key);
        return (
          <g
            key={g.key}
            data-group={g.key}
            className={`cursor-pointer ${EASE}`}
            style={{ opacity: dim ? 0.35 : 1 }}
            onPointerEnter={() => onActive(g.key)}
            onClick={() => onOpen(g.key)}
          >
            {/* Generous invisible hit area over arc and label. */}
            <path d={arcPath(R - BAND - 4, R + ARC + LABEL - 20, g)} fill="transparent" />
            <path d={arcPath(R, R + ARC, g)} fill={color} />
            {g.internal && <path data-internal={g.key} d={arcPath(R - BAND, R - 2, g.internal)} fill={color} opacity={0.4} />}
            <text
              transform={`rotate(${deg(mid) - 90}) translate(${R + ARC + 12} 0)${flip ? " rotate(180)" : ""}`}
              textAnchor={flip ? "end" : "start"}
              dominantBaseline="central"
              className="fill-foreground text-[13px] font-medium"
            >
              {nameOf(g.key)}
            </text>
          </g>
        );
      })}
      </g>
    </svg>
  );
}

/** Narrow layout: ranked bars, From to To, each group scaled to its own largest flow. */
function FlowBars({ title, flows, nameOf }: { title: string; flows: Flow[]; nameOf: (k: string) => string }) {
  const f = useFormat();
  if (flows.length === 0) return null;
  const max = flows[0]!.btc;
  return (
    <div className="space-y-3">
      <h3 className="eyebrow">{title}</h3>
      <ol className="space-y-3.5" data-testid="obs-flow-bars">
        {flows.map((x) => (
          <li key={`${x.from}>${x.to}`} data-flow={`${x.from}>${x.to}`} className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-foreground">
                <span className="inline-flex items-center gap-1.5"><Dot coordKey={x.from} />{nameOf(x.from)}</span>
                {!x.internal && (
                  <>
                    <ArrowRight size={12} aria-hidden="true" className="text-faint" />
                    <span className="sr-only">,</span>
                    <span className="inline-flex items-center gap-1.5"><Dot coordKey={x.to} />{nameOf(x.to)}</span>
                  </>
                )}
              </span>
              <span className="num shrink-0 text-foreground">{f.btc(x.btc)}</span>
            </div>
            <div aria-hidden="true" className="h-1.5 rounded-full bg-surface-inset">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.max(2, (100 * x.btc) / max)}%`, background: `linear-gradient(to right, ${coordinatorFgVar(x.from)}, ${coordinatorFgVar(x.to)})` }}
              />
            </div>
            <p className="num text-xs text-faint">{f.coins(x.coins)}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export interface RemixFlowsProps {
  scene: Scene;
  onOpenCoordinator: (key: string) => void;
}

/**
 * Where remixed coins went: a chord diagram on wide screens (arcs per coordinator, ribbons between
 * them, internal remix as an inner band), ranked bars below 640 px, and the cross-coordinator total.
 */
export function RemixFlows({ scene, onOpenCoordinator }: RemixFlowsProps) {
  const { t, i18n } = useTranslation();
  const f = useFormat();
  const [active, setActive] = useState<string | null>(null);
  const names = useMemo(() => new Map(scene.stars.map((s) => [s.key, s.name])), [scene.stars]);
  const nameOf = (k: string) => names.get(k) ?? k;
  const groups = useMemo(() => chordLayout(scene.flows).groups, [scene.flows]);
  const ranked = useMemo(() => rankFlows(scene.flows), [scene.flows]);
  const cross = scene.totals.CrossRemixBtc;
  const remixed = cross + scene.totals.InternalRemixBtc;
  const crossCoins = ranked.cross.reduce((s, x) => s + x.coins, 0);
  const card = `rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) p-5 sm:p-8 ${FADE}`;

  if (groups.length === 0) {
    return (
      <div className={card}>
        <p className="text-sm text-muted">{t("observatory.wabisabi.table.noFlows", { defaultValue: "No remix flows in this period." })}</p>
      </div>
    );
  }

  return (
    <div className={card}>
      <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-center">
        <div className="space-y-2.5 lg:col-span-2" data-testid="obs-flows-total">
          <p className="eyebrow">{t("observatory.wabisabi.flows.totalLabel", { defaultValue: "Crossed between coordinators" })}</p>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">{fmtBtc(cross, i18n.language || "en")}</span>
            <span className="text-lg text-muted">BTC</span>
            <span className="num text-sm text-faint">{f.coins(crossCoins)}</span>
          </p>
          {remixed > 0 && (
            <p className="max-w-2xl text-sm sm:text-base text-muted leading-relaxed text-pretty">
              {t("observatory.wabisabi.flows.share", {
                defaultValue: "Only {{share}} of all remixed bitcoin moved to another coordinator. The other {{rest}} was remixed where it was already mixed.",
                share: f.pct(cross / remixed),
                rest: f.pct(1 - cross / remixed),
              })}
            </p>
          )}
        </div>

        <div className="hidden sm:block">
          <Chord scene={scene} active={active} onActive={setActive} onOpen={onOpenCoordinator} nameOf={nameOf} />
        </div>

        <div className="hidden sm:block space-y-4">
          <Readout group={groups.find((g) => g.key === active) ?? null} name={active ? nameOf(active) : ""} />
          <ul aria-label={t("observatory.wabisabi.flows.legend", { defaultValue: "Coordinators in the diagram" })} className="space-y-1">
            {groups.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  data-legend={g.key}
                  onPointerEnter={() => setActive(g.key)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(g.key)}
                  onBlur={() => setActive(null)}
                  onClick={() => onOpenCoordinator(g.key)}
                  aria-label={t("observatory.wabisabi.flows.legendItem", {
                    defaultValue: "{{name}}: {{total}} through it. Open its page.",
                    name: nameOf(g.key),
                    total: f.btc(g.total),
                  })}
                  className={`flex w-full min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm text-left transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin ${active === g.key ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
                >
                  <Dot coordKey={g.key} />
                  <span className="min-w-0 flex-1 truncate">{nameOf(g.key)}</span>
                  <span className="num shrink-0 text-xs">{f.btc(g.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="sm:hidden space-y-8">
          <FlowBars title={t("observatory.wabisabi.flows.between", { defaultValue: "Between coordinators" })} flows={ranked.cross} nameOf={nameOf} />
          <FlowBars title={t("observatory.wabisabi.flows.internal", { defaultValue: "Internal remix" })} flows={ranked.internal} nameOf={nameOf} />
        </div>
      </div>
    </div>
  );
}
