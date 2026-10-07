"use client";

import { useCallback, useId, useMemo, useState, type KeyboardEvent, type MouseEvent, type TouchEvent } from "react";
import { useTranslation } from "react-i18next";
import { ParentSize } from "@visx/responsive";
import { scaleLinear, scaleUtc } from "@visx/scale";
import { AreaClosed, Bar, Line, LinePath } from "@visx/shape";
import { Group } from "@visx/group";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { TooltipWithBounds } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { bisector } from "d3-array";
import { curveMonotoneX } from "d3-shape";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import { tooltipStyles } from "@/components/observatory/TrendChart";

export interface HistoryPoint { date: string; volume: number; coinjoins: number }

interface VolumeHistoryChartProps {
  points: HistoryPoint[];
  ath: { date: string; volume: number } | null;
  /** CSS colour (a coordinator `-fg` var) for the line, area and markers. */
  color: string;
  /** Accessible summary of what the chart shows. */
  label: string;
  /** The last point is today's UTC day, still in progress: drawn dashed so the line does not read as a crash. */
  partialLast?: boolean;
  height?: number;
}

const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const bisectDate = bisector<HistoryPoint, number>((p) => ms(p.date)).center;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bitcoin";

/**
 * Daily volume as a crisp line over a soft area in the coordinator colour, the all-time high
 * annotated, and a tooltip on hover, touch or keyboard (arrows, Home, End).
 */
export function VolumeHistoryChart({ points, height = 260, ...rest }: VolumeHistoryChartProps) {
  const { t } = useTranslation();
  if (points.length === 0) {
    return (
      <div data-testid="volume-chart" data-points={0} style={{ height }} className="grid place-items-center rounded-lg border border-dashed border-hairline text-sm text-muted">
        {t("observatory.wabisabi.coord.noHistory", { defaultValue: "No CoinJoin history for this range." })}
      </div>
    );
  }
  return (
    <div style={{ height }}>
      <ParentSize>
        {({ width, height: h }) => (width > 0 && h > 0 ? <Inner points={points} width={width} height={h} {...rest} /> : null)}
      </ParentSize>
    </div>
  );
}

function Inner({ points, ath, color, label, partialLast = false, width, height }: VolumeHistoryChartProps & { width: number; height: number }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const gradId = `vh-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;
  const [active, setActive] = useState<number | null>(null);

  const narrow = width < 480;
  const margin = { top: 20, right: narrow ? 8 : 16, bottom: 28, left: narrow ? 40 : 56 };
  const iw = Math.max(0, width - margin.left - margin.right);
  const ih = Math.max(0, height - margin.top - margin.bottom);

  const spanDays = (ms(points.at(-1)!.date) - ms(points[0]!.date)) / 86_400_000;
  const fmt = useMemo(() => ({
    tick: new Intl.DateTimeFormat(locale, spanDays > 120 ? { month: "short", year: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", timeZone: "UTC" }),
    long: new Intl.DateTimeFormat(locale, { weekday: "short", year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }),
    y: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
  }), [locale, spanDays]);

  const { x, y } = useMemo(() => {
    const max = Math.max(...points.map((p) => p.volume), 0);
    return {
      x: scaleUtc({ domain: [ms(points[0]!.date), Math.max(ms(points.at(-1)!.date), ms(points[0]!.date) + 86_400_000)], range: [0, iw] }),
      y: scaleLinear({ domain: [0, max > 0 ? max * 1.08 : 1], range: [ih, 0], nice: true }),
    };
  }, [points, iw, ih]);

  // Greedy: keep a tick only when its label clears the previous one ("Oct 2026" is ~60 px).
  const xTicks = x.ticks(iw > 520 ? 6 : 4).reduce<Date[]>((kept, d) => {
    const prev = kept.at(-1);
    if (!prev || x(d) - x(prev) >= 84) kept.push(d);
    return kept;
  }, []);
  const px = (p: HistoryPoint) => x(ms(p.date));
  const py = (p: HistoryPoint) => y(p.volume);

  const onPointer = useCallback((e: MouseEvent<SVGRectElement> | TouchEvent<SVGRectElement>) => {
    const pt = localPoint(e);
    if (pt) setActive(bisectDate(points, x.invert(pt.x - margin.left).getTime()));
  }, [points, x, margin.left]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    const cur = active ?? last;
    const next = e.key === "ArrowLeft" ? cur - 1 : e.key === "ArrowRight" ? cur + 1 : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  };

  const partial = partialLast && points.length > 1;
  const solid = partial ? points.slice(0, -1) : points;
  const inProgress = t("observatory.wabisabi.coord.partialDay", { defaultValue: "Day in progress" });
  const athIdx = ath ? points.findIndex((p) => p.date === ath.date) : -1;
  const athPt = athIdx >= 0 ? points[athIdx]! : null;
  const hover = active !== null ? points[active] ?? null : null;
  const hoverPartial = partial && active === points.length - 1;
  const tipText = hover
    ? `${fmt.long.format(ms(hover.date))}${hoverPartial ? ` (${inProgress})` : ""}: ${fmtBtc(hover.volume, locale)} BTC, ${t("observatory.wabisabi.coord.chartCoinjoins", { defaultValue: "{{formatted}} CoinJoins", count: hover.coinjoins, formatted: fmtCount(hover.coinjoins, locale) })}`
    : "";

  return (
    <div
      data-testid="volume-chart"
      data-points={points.length}
      tabIndex={0}
      role="group"
      aria-label={label}
      aria-roledescription={t("observatory.wabisabi.coord.chartRole", { defaultValue: "chart" })}
      onKeyDown={onKey}
      onFocus={() => setActive((a) => a ?? points.length - 1)}
      onBlur={() => setActive(null)}
      className={`relative rounded-md text-muted ${FOCUS}`}
      style={{ width, height }}
    >
      <svg width={width} height={height} aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.26 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <Group left={margin.left} top={margin.top}>
          {y.ticks(4).map((v) => (
            <line key={v} x1={0} x2={iw} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.3 : 0.1} strokeDasharray={v === 0 ? undefined : "2,3"} />
          ))}
          <AreaClosed data={solid} x={px} y={py} yScale={y} curve={curveMonotoneX} stroke="none" fill={`url(#${gradId})`} />
          <LinePath data={solid} x={px} y={py} curve={curveMonotoneX} style={{ stroke: color }} strokeWidth={1.75} strokeLinejoin="round" fill="none" />
          {partial && <LinePath data={points.slice(-2)} x={px} y={py} style={{ stroke: color }} strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="3,3" fill="none" />}
          <AxisBottom
            top={ih}
            scale={x}
            tickValues={xTicks}
            tickFormat={(v) => fmt.tick.format(v instanceof Date ? v : new Date(Number(v)))}
            hideAxisLine
            hideTicks
            // Edge labels anchor inward so "Oct 2026" is never clipped at the chart's side.
            tickLabelProps={(v) => {
              const tx = x(v instanceof Date ? v : new Date(Number(v)));
              return { fill: "currentColor", fontSize: 11, textAnchor: tx > iw - 32 ? "end" : tx < 32 ? "start" : "middle", dy: 6, className: "num" };
            }}
          />
          <AxisLeft
            scale={y}
            numTicks={4}
            tickFormat={(v) => fmt.y.format(Number(v))}
            hideAxisLine
            hideTicks
            tickLabelProps={() => ({ fill: "currentColor", fontSize: 11, textAnchor: "end", dx: -8, dy: 4, className: "num" })}
          />
          {athPt && <AthMarker x={px(athPt)} y={py(athPt)} iw={iw} ih={ih} color={color} title={t("observatory.wabisabi.coord.athMarker", { defaultValue: "All-time high, {{volume}} BTC", volume: fmtBtc(athPt.volume, locale) })} date={fmt.long.format(ms(athPt.date))} />}
          {hover && (
            <g pointerEvents="none">
              <Line from={{ x: px(hover), y: 0 }} to={{ x: px(hover), y: ih }} stroke="currentColor" strokeOpacity={0.35} strokeDasharray="2,3" />
              <circle cx={px(hover)} cy={py(hover)} r={4.5} style={{ fill: color, stroke: "var(--card-bg)" }} strokeWidth={2} />
            </g>
          )}
          <Bar
            x={0}
            y={0}
            width={iw}
            height={ih}
            fill="transparent"
            onMouseMove={onPointer}
            onMouseLeave={() => setActive(null)}
            onTouchStart={onPointer}
            onTouchMove={onPointer}
            onTouchEnd={() => setActive(null)}
          />
        </Group>
      </svg>
      {hover && (
        <TooltipWithBounds top={margin.top + py(hover)} left={margin.left + px(hover)} style={tooltipStyles}>
          <div data-testid="chart-tooltip" className="space-y-0.5">
            <div className="text-[11px] text-muted">
              {fmt.long.format(ms(hover.date))}
              {hoverPartial && <span className="ml-1.5 rounded bg-surface-2 px-1 py-px text-[10px]">{inProgress}</span>}
            </div>
            <div className="num text-sm font-semibold text-foreground">{fmtBtc(hover.volume, locale)} BTC</div>
            <div className="num text-[11px] text-muted">{t("observatory.wabisabi.coord.chartCoinjoins", { defaultValue: "{{formatted}} CoinJoins", count: hover.coinjoins, formatted: fmtCount(hover.coinjoins, locale) })}</div>
          </div>
        </TooltipWithBounds>
      )}
      <p aria-live="polite" className="sr-only">{tipText}</p>
    </div>
  );
}

/** A ringed dot on the ATH day with a two-line label set to the side that has room. */
function AthMarker({ x, y, iw, ih, color, title, date }: { x: number; y: number; iw: number; ih: number; color: string; title: string; date: string }) {
  const right = x < iw * 0.6;
  const anchor = right ? "start" : "end";
  const dx = right ? 12 : -12;
  const ly = Math.min(Math.max(y + 4, 12), ih - 18);
  const halo = { paintOrder: "stroke", stroke: "var(--card-bg)", strokeWidth: 4, strokeLinejoin: "round" } as const;
  return (
    <g data-testid="ath-marker" pointerEvents="none">
      <Line from={{ x, y }} to={{ x, y: ih }} style={{ stroke: color }} strokeOpacity={0.45} strokeDasharray="1,3" />
      <circle cx={x} cy={y} r={8} style={{ fill: color }} fillOpacity={0.18} />
      <circle cx={x} cy={y} r={3.5} style={{ fill: color, stroke: "var(--card-bg)" }} strokeWidth={1.5} />
      <text x={x + dx} y={ly} textAnchor={anchor} fontSize={12} fontWeight={600} className="num" style={{ ...halo, fill: "var(--foreground)" }}>{title}</text>
      <text x={x + dx} y={ly + 15} textAnchor={anchor} fontSize={11} style={{ ...halo, fill: "var(--muted)" }}>{date}</text>
    </g>
  );
}
