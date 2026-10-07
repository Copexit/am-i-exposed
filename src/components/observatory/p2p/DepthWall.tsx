"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ParentSize } from "@visx/responsive";
import { scaleLinear } from "@visx/scale";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { BarChart3, Table2, X } from "lucide-react";
import type { DepthPoint, Market, VenueHost } from "@/lib/observatory/p2p/types";
import { depthClip, makerSide } from "@/lib/observatory/p2p/market";
import { fmtFiat, fmtPremium, fmtSatsBtc } from "@/lib/observatory/p2p/p2p-format";
import { hostColorVar } from "@/lib/observatory/p2p/venue-palette";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useMedia, useReducedMotion } from "@/components/observatory/wabisabi/SkyMap";
import { CHIP, CHIP_OFF, CHIP_ON, FADE, VENUE_LABEL } from "./p2p-ui";
import { OfferCard, hostName, hostNames } from "./offer-facts";

interface Props {
  market: Market | null;
  side: "buy" | "sell";
  view: "map" | "table";
  hosts: VenueHost[];
  /** Other markets to suggest when this one is empty on the chosen side. */
  nearest: string[];
  onView: (view: "map" | "table") => void;
  onPickCurrency: (cur: string) => void;
}

const MARGIN = { top: 28, right: 16, bottom: 30, left: 52 };

interface Clipped { sell: DepthPoint[]; buy: DepthPoint[]; below: number; above: number; lo: number; hi: number }

/** One premium window for both sides (2nd to 98th percentile of all priced offers), the rest counted at the edges. */
function clipBoth(m: Market): Clipped {
  const all = [...m.depth.sell, ...m.depth.buy];
  const c = depthClip(all);
  const keep = new Set(c.points);
  const kept = c.points.map((p) => p.premium);
  const lo = Math.min(0, ...kept);
  const hi = Math.max(0, ...kept);
  return { sell: m.depth.sell.filter((p) => keep.has(p)), buy: m.depth.buy.filter((p) => keep.has(p)), below: c.below, above: c.above, lo, hi };
}

export function DepthWall({ market, side, view, hosts, nearest, onView, onPickCurrency }: Props) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const maker = makerSide(side);
  const listed = market?.offers.filter((o) => o.side === maker) ?? [];
  const names = useMemo(() => hostNames(hosts), [hosts]);
  const wide = useMedia("(min-width: 640px)");
  const height = wide ? 320 : 240;

  const toggle = (
    <div role="group" aria-label={t("observatory.p2p.wall.viewLabel", { defaultValue: "Depth view" })} className="inline-flex gap-1 p-1 rounded-lg bg-surface-inset border border-card-border">
      {([["map", BarChart3, t("observatory.p2p.wall.chart", { defaultValue: "Chart" })], ["table", Table2, t("observatory.p2p.wall.table", { defaultValue: "Table" })]] as const).map(([id, Icon, label]) => (
        <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)} className={`${CHIP} ${view === id ? CHIP_ON : CHIP_OFF}`}>
          <Icon size={14} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );

  if (!market || listed.length === 0) {
    const cur = market?.currency ?? "";
    return (
      <div data-testid="p2p-empty" className="rounded-xl border border-dashed border-hairline-strong px-5 py-8 text-center space-y-4">
        <p className="text-base text-foreground text-balance">
          {side === "buy"
            ? t("observatory.p2p.empty.buy", { defaultValue: "No KYC-free offers to buy in {{cur}} right now.", cur })
            : t("observatory.p2p.empty.sell", { defaultValue: "No KYC-free offers to sell in {{cur}} right now.", cur })}
        </p>
        {nearest.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className="text-sm text-muted">{t("observatory.p2p.empty.try", { defaultValue: "Busiest markets:" })}</span>
            {nearest.map((c) => (
              <button key={c} type="button" onClick={() => onPickCurrency(c)} className={`${CHIP} num border border-hairline ${CHIP_OFF}`}>{c}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const unpriced = market.index === null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {market.index !== null
            ? t("observatory.p2p.wall.caption", { defaultValue: "Cumulative BTC by premium. Index {{price}} per BTC.", price: fmtFiat(market.index, market.currency, locale) })
            : t("observatory.p2p.wall.noIndex", { defaultValue: "No index price for {{cur}}: premiums are as declared by each venue.", cur: market.currency })}
        </p>
        {toggle}
      </div>
      {view === "table" ? (
        <DepthTable points={market.depth[maker]} names={names} />
      ) : unpriced && market.depth[maker].length === 0 ? null : (
        <div style={{ height }} className="relative">
          <ParentSize>
            {({ width }) => (width > 0 ? <Chart market={market} side={side} width={width} height={height} names={names} wide={wide} /> : null)}
          </ParentSize>
        </div>
      )}
    </div>
  );
}

function DepthTable({ points, names }: { points: DepthPoint[]; names: Map<string, string> }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  return (
    <div className="max-h-[420px] overflow-auto rounded-xl border border-hairline">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("observatory.p2p.wall.tableCaption", { defaultValue: "Depth steps by premium" })}</caption>
        <thead className="sticky top-0 bg-surface-inset text-left text-xs text-faint">
          <tr>
            <th scope="col" className="px-3 py-2 font-normal">{t("observatory.p2p.list.premium", { defaultValue: "Premium" })}</th>
            <th scope="col" className="px-3 py-2 font-normal text-right">{t("observatory.p2p.wall.cumulative", { defaultValue: "Cumulative BTC" })}</th>
            <th scope="col" className="px-3 py-2 font-normal">{t("observatory.p2p.list.venue", { defaultValue: "Venue" })}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.offer?.id ?? i} className="border-t border-hairline">
              <td className="num px-3 py-2 text-foreground">{fmtPremium(p.premium, locale)}</td>
              <td className="num px-3 py-2 text-right text-muted">{fmtSatsBtc(p.cumSats, locale)}</td>
              <td className="px-3 py-2 text-muted">{p.offer ? `${VENUE_LABEL[p.offer.venue]} · ${hostName(names, p.offer)}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ market, side, width, height, names, wide }: { market: Market; side: "buy" | "sell"; width: number; height: number; names: Map<string, string>; wide: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const reduced = useReducedMotion();
  const maker = makerSide(side);
  const c = useMemo(() => clipBoth(market), [market]);
  const [hover, setHover] = useState<DepthPoint | null>(null);
  const [pinned, setPinned] = useState<DepthPoint | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef, !wide && pinned !== null);

  const iw = Math.max(10, width - MARGIN.left - MARGIN.right);
  const ih = Math.max(10, height - MARGIN.top - MARGIN.bottom);
  const pad = Math.max(0.5, (c.hi - c.lo) * 0.04);
  const x = scaleLinear({ domain: [c.lo - pad, c.hi + pad], range: [0, iw] });
  const ymax = Math.max(1, ...c.sell.map((p) => p.cumSats), ...c.buy.map((p) => p.cumSats));
  const y = scaleLinear({ domain: [0, ymax * 1.08], range: [ih, 0], nice: true });

  /** One rect per step, coloured by the venue (or coordinator) whose offer adds it. */
  const steps = (pts: DepthPoint[], dir: 1 | -1) =>
    pts.map((p, i) => {
      const next = pts[i + 1];
      const x0 = x(p.premium);
      const x1 = next ? x(next.premium) : dir === 1 ? iw : 0;
      return { p, left: Math.min(x0, x1), w: Math.abs(x1 - x0), top: y(p.cumSats) };
    });
  const sides = [
    { key: "sell" as const, pts: c.sell, dir: 1 as const },
    { key: "buy" as const, pts: c.buy, dir: -1 as const },
  ];
  /** The staircase outline: up at each offer, then flat to the next one, out to the chart edge. */
  const stepPath = (pts: DepthPoint[], dir: 1 | -1) => {
    if (!pts.length) return "";
    let d = `M${x(pts[0]!.premium)},${ih}`;
    pts.forEach((p, i) => {
      const nx = pts[i + 1] ? x(pts[i + 1]!.premium) : dir === 1 ? iw : 0;
      d += `V${y(p.cumSats)}H${nx}`;
    });
    return d;
  };
  const active = hover ?? (wide ? pinned : null);
  const median = market.medianPremium[side];
  const x0 = x(0);
  const card = (p: DepthPoint) => p.offer && <OfferCard offer={p.offer} names={names} median={median} intent={side} />;
  const label = (p: DepthPoint) => p.offer
    ? `${VENUE_LABEL[p.offer.venue]}, ${hostName(names, p.offer)}, ${fmtPremium(p.premium, locale)}, ${fmtSatsBtc(p.offer.satsMax ?? 0, locale)} BTC`
    : fmtPremium(p.premium, locale);

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={t("observatory.p2p.wall.aria", { defaultValue: "Depth of {{cur}} offers by premium over the index", cur: market.currency })}
        className="block overflow-visible text-faint"
        data-animated={reduced ? "false" : "true"}
      >
        <Group left={MARGIN.left} top={MARGIN.top}>
          {y.ticks(4).map((v) => (
            <line key={v} x1={0} x2={iw} y1={y(v)} y2={y(v)} stroke="var(--hairline)" />
          ))}
          <g key={`${market.currency}-${side}`} className={reduced ? "" : "motion-safe:animate-[p2p-wall-in_700ms_cubic-bezier(0.22,1,0.36,1)]"}>
            {sides.map(({ key, pts, dir }) => (
              <g key={key} opacity={key === maker ? 1 : 0.28}>
                {steps(pts, dir).map(({ p, left, w, top }) => (
                  <rect
                    key={p.offer?.id ?? `${p.premium}-${p.cumSats}`}
                    x={left}
                    y={top}
                    width={Math.max(0.5, w)}
                    height={Math.max(0, ih - top)}
                    fill={p.offer ? hostColorVar(p.offer.venue, p.offer.host, false) : "var(--faint)"}
                    fillOpacity={active === p ? 0.8 : 0.42}
                  />
                ))}
                <path d={stepPath(pts, dir)} fill="none" stroke="var(--foreground)" strokeOpacity={0.55} strokeWidth={1.25} />
              </g>
            ))}
          </g>
          {/* The index: 0 % premium. */}
          <line x1={x0} x2={x0} y1={-8} y2={ih} stroke="var(--muted)" strokeDasharray="2 3" />
          <text x={x0} y={-14} textAnchor="middle" fontSize={11} fill="var(--muted)" className="num">
            {market.index !== null ? fmtFiat(market.index, market.currency, locale, !wide) : t("observatory.p2p.wall.index", { defaultValue: "Index" })}
          </text>
          {c.below > 0 && (
            <text x={0} y={-14} fontSize={11} fill="var(--faint)" className="num">{`← ${t("observatory.p2p.wall.beyond", { defaultValue: "{{count}} beyond", count: c.below })}`}</text>
          )}
          {c.above > 0 && (
            <text x={iw} y={-14} textAnchor="end" fontSize={11} fill="var(--faint)" className="num">{`${t("observatory.p2p.wall.beyond", { defaultValue: "{{count}} beyond", count: c.above })} →`}</text>
          )}
          {sides.map(({ key, pts }) => pts.map((p) => (
            <circle
              key={`m-${p.offer?.id ?? p.premium}`}
              data-testid="p2p-wall-marker"
              cx={x(p.premium)}
              cy={y(p.cumSats)}
              r={active === p ? 4.5 : key === maker ? 2.5 : 1.75}
              fill={p.offer ? hostColorVar(p.offer.venue, p.offer.host) : "var(--faint)"}
              stroke="var(--background)"
              strokeWidth={1}
              opacity={key === maker ? 1 : 0.5}
              tabIndex={key === maker ? 0 : -1}
              role="button"
              aria-label={label(p)}
              onFocus={() => setHover(p)}
              onBlur={() => setHover((h) => (h === p ? null : h))}
              onMouseEnter={() => setHover(p)}
              onClick={() => setPinned((cur) => (cur === p ? null : p))}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPinned(p); } }}
              className="cursor-pointer outline-none focus-visible:stroke-bitcoin focus-visible:[stroke-width:2]"
            />
          )))}
          <AxisLeft
            scale={y}
            numTicks={4}
            tickFormat={(v) => fmtSatsBtc(Number(v), locale)}
            hideAxisLine
            hideTicks
            tickLabelProps={() => ({ fill: "currentColor", fontSize: 11, textAnchor: "end", dx: -8, dy: 4, className: "num" })}
          />
          <AxisBottom
            top={ih}
            scale={x}
            numTicks={wide ? 8 : 4}
            tickFormat={(v) => fmtPremium(Number(v), locale)}
            hideAxisLine
            hideTicks
            tickLabelProps={() => ({ fill: "currentColor", fontSize: 11, textAnchor: "middle", dy: 6, className: "num" })}
          />
        </Group>
      </svg>

      {wide && active?.offer && (
        <div
          data-testid="p2p-wall-card"
          className={`pointer-events-none absolute z-10 w-72 rounded-xl border border-card-border bg-surface-float p-3 shadow-(--shadow-pop) ${FADE}`}
          style={{
            left: Math.min(Math.max(0, MARGIN.left + x(active.premium) - 144), width - 288),
            top: Math.max(0, MARGIN.top + y(active.cumSats) - 150),
          }}
        >
          {card(active)}
        </div>
      )}

      {!wide && pinned?.offer && (
        <div className="fixed inset-0 z-50 flex items-end bg-background/60 backdrop-blur-sm" onClick={() => setPinned(null)}>
          <div
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={label(pinned)}
            data-testid="p2p-wall-sheet"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => { if (e.key === "Escape") setPinned(null); }}
            className={`w-full rounded-t-2xl border-t border-card-border bg-surface-float p-4 pb-[max(1rem,env(safe-area-inset-bottom))] ${FADE}`}
          >
            <div className="mb-3 flex justify-end">
              <button type="button" autoFocus onClick={() => setPinned(null)} aria-label={t("observatory.p2p.wall.close", { defaultValue: "Close" })} className="grid size-10 place-items-center rounded-lg text-muted hover:text-foreground">
                <X size={16} aria-hidden="true" />
              </button>
            </div>
            {card(pinned)}
          </div>
        </div>
      )}
      <p className="sr-only">{t("observatory.p2p.wall.count", { defaultValue: "{{count}} offers on the chart", count: (maker === "sell" ? c.sell : c.buy).length })}</p>
    </div>
  );
}

