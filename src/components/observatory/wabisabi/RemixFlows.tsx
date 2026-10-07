"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";
import { coordinatorFgVar } from "@/lib/observatory/coordinator-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import { rankFlows, type Flow, type Scene } from "@/lib/observatory/sky-model";

const FADE = "motion-safe:animate-[obs-fade_250ms_ease-out]";
const EASE = "transition-[opacity,background-color] duration-300 ease-out motion-reduce:transition-none";

function Dot({ coordKey }: { coordKey: string }) {
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ background: coordinatorFgVar(coordKey) }} />;
}

function useFormat() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  return {
    locale,
    btc: (v: number) => `${fmtBtc(v, locale)} BTC`,
    coins: (n: number) => t("observatory.wabisabi.flows.coins", { count: n, formatted: fmtCount(n, locale), defaultValue: "{{formatted}} coins" }),
    pct: (v: number) => v.toLocaleString(locale, { style: "percent", maximumFractionDigits: v < 0.01 ? 2 : 1 }),
  };
}

/** The row under the pointer or focus: rows sharing one of its coordinators stay lit, the rest dim. */
type Active = { from: string; to: string } | null;
const lit = (f: Flow, a: Active) => !a || f.from === a.from || f.from === a.to || f.to === a.from || f.to === a.to;

/** Ranked flows, From to To, scaled to the list's largest flow. A row opens its From coordinator. */
function FlowBars({ title, flows, nameOf, active, onActive, onOpen }: { title: string; flows: Flow[]; nameOf: (k: string) => string; active: Active; onActive: (a: Active) => void; onOpen: (k: string) => void }) {
  const { t } = useTranslation();
  const f = useFormat();
  if (flows.length === 0) return null;
  const max = flows[0]!.btc;
  return (
    <div className="min-w-0 space-y-3">
      <h3 className="eyebrow">{title}</h3>
      <ol className="-mx-2.5 space-y-1" data-testid="obs-flow-bars">
        {flows.map((x) => {
          const on = () => onActive({ from: x.from, to: x.to });
          return (
            <li key={`${x.from}>${x.to}`}>
              <button
                type="button"
                data-flow={`${x.from}>${x.to}`}
                onPointerEnter={on}
                onPointerLeave={() => onActive(null)}
                onFocus={on}
                onBlur={() => onActive(null)}
                onClick={() => onOpen(x.from)}
                aria-label={
                  x.internal
                    ? t("observatory.wabisabi.flows.rowInternal", { defaultValue: "{{from}}, internal remix: {{btc}}, {{coins}}. Open {{from}}.", from: nameOf(x.from), btc: f.btc(x.btc), coins: f.coins(x.coins) })
                    : t("observatory.wabisabi.flows.row", { defaultValue: "{{from}} to {{to}}: {{btc}}, {{coins}}. Open {{from}}.", from: nameOf(x.from), to: nameOf(x.to), btc: f.btc(x.btc), coins: f.coins(x.coins) })
                }
                className={`block w-full min-h-10 space-y-1.5 rounded-lg px-2.5 py-2 text-left cursor-pointer hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-2 focus-visible:outline-bitcoin ${EASE}`}
                style={{ opacity: lit(x, active) ? 1 : 0.35 }}
              >
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-foreground">
                    <span className="inline-flex items-center gap-1.5"><Dot coordKey={x.from} />{nameOf(x.from)}</span>
                    {!x.internal && (
                      <>
                        <ArrowRight size={12} aria-hidden="true" className="text-faint" />
                        <span className="inline-flex items-center gap-1.5"><Dot coordKey={x.to} />{nameOf(x.to)}</span>
                      </>
                    )}
                  </span>
                  <span className="num shrink-0 text-foreground">{f.btc(x.btc)}</span>
                </span>
                <span aria-hidden="true" className="block h-1.5 rounded-full bg-surface-inset">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${Math.max(2, (100 * x.btc) / max)}%`, background: `linear-gradient(to right, ${coordinatorFgVar(x.from)}, ${coordinatorFgVar(x.to)})` }}
                  />
                </span>
                <span className="num block text-xs text-faint">{f.coins(x.coins)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export interface RemixFlowsProps {
  scene: Scene;
  onOpenCoordinator: (key: string) => void;
}

/**
 * Where remixed coins went: the cross-coordinator total, one bar for the crossed vs internal share,
 * and the ranked flows (between coordinators, internal remix), side by side from 640 px.
 */
export function RemixFlows({ scene, onOpenCoordinator }: RemixFlowsProps) {
  const { t } = useTranslation();
  const f = useFormat();
  const [active, setActive] = useState<Active>(null);
  const names = useMemo(() => new Map(scene.stars.map((s) => [s.key, s.name])), [scene.stars]);
  const nameOf = (k: string) => names.get(k) ?? k;
  const ranked = useMemo(() => rankFlows(scene.flows), [scene.flows]);
  const cross = scene.totals.CrossRemixBtc;
  const remixed = cross + scene.totals.InternalRemixBtc;
  const share = remixed > 0 ? cross / remixed : 0;
  const crossCoins = ranked.cross.reduce((s, x) => s + x.coins, 0);
  const card = `rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) p-5 sm:p-8 ${FADE}`;
  const betweenLabel = t("observatory.wabisabi.flows.between", { defaultValue: "Between coordinators" });
  const internalLabel = t("observatory.wabisabi.flows.internal", { defaultValue: "Internal remix" });

  if (ranked.cross.length + ranked.internal.length === 0) {
    return (
      <div className={card}>
        <p className="text-sm text-muted">{t("observatory.wabisabi.table.noFlows", { defaultValue: "No remix flows in this period." })}</p>
      </div>
    );
  }

  return (
    <div className={`${card} space-y-8 sm:space-y-10`}>
      <div className="space-y-5">
        <div className="space-y-2.5" data-testid="obs-flows-total">
          <p className="eyebrow">{t("observatory.wabisabi.flows.totalLabel", { defaultValue: "Crossed between coordinators" })}</p>
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="num text-4xl sm:text-5xl font-semibold tracking-tight text-foreground">{fmtBtc(cross, f.locale)}</span>
            <span className="text-lg text-muted">BTC</span>
            <span className="num text-sm text-faint">{f.coins(crossCoins)}</span>
          </p>
          {remixed > 0 && (
            <p className="max-w-2xl text-sm sm:text-base text-muted leading-relaxed text-pretty">
              {t("observatory.wabisabi.flows.share", {
                defaultValue: "{{share}} of all remixed bitcoin moved to another coordinator. The other {{rest}} was remixed where it was already mixed.",
                share: f.pct(share),
                rest: f.pct(1 - share),
              })}
            </p>
          )}
        </div>

        {remixed > 0 && (
          <div className="space-y-2.5" data-testid="obs-flows-share">
            <div aria-hidden="true" className="flex h-3 gap-[3px]">
              {share > 0 && <span data-part="cross" className={`h-full rounded-l-full bg-bitcoin ${share < 1 ? "" : "rounded-r-full"}`} style={{ width: `${100 * share}%`, minWidth: 4 }} />}
              {share < 1 && <span data-part="internal" className={`h-full flex-1 rounded-r-full bg-faint/45 ${share > 0 ? "" : "rounded-l-full"}`} />}
            </div>
            <dl className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-sm">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-full bg-bitcoin" />
                <dt className="text-muted">{betweenLabel}</dt>
                <dd className="num text-foreground">{f.pct(share)}</dd>
              </div>
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-full bg-faint/45" />
                <dt className="text-muted">{internalLabel}</dt>
                <dd className="num text-foreground">{f.pct(1 - share)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
        <FlowBars title={betweenLabel} flows={ranked.cross} nameOf={nameOf} active={active} onActive={setActive} onOpen={onOpenCoordinator} />
        <FlowBars title={internalLabel} flows={ranked.internal} nameOf={nameOf} active={active} onActive={setActive} onOpen={onOpenCoordinator} />
      </div>
    </div>
  );
}
