"use client";

import { SVG_COLORS } from "../shared/svgConstants";

interface Badge {
  label: string;
  /** Mark color for the pill tint and outline; the label is always foreground (AA on any tint, both themes). */
  color: string;
}

interface NodeBadgesProps {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  isCoinJoin: boolean;
  coinJoinType?: string;
  isOfac?: boolean;
  isToxicMerge: boolean;
  toxicLabel?: string;
  isUnconfirmed?: boolean;
  unconfirmedLabel?: string;
  /** Space kept clear at the right edge (the heat-map sparkline). */
  rightInset?: number;
}

export function NodeBadges({
  nodeX,
  nodeY,
  nodeWidth,
  isCoinJoin,
  coinJoinType,
  isOfac,
  isToxicMerge,
  toxicLabel,
  isUnconfirmed,
  unconfirmedLabel,
  rightInset = 0,
}: NodeBadgesProps) {
  const badges: Badge[] = [];
  if (isCoinJoin) badges.push({ label: coinJoinType ?? "CJ", color: SVG_COLORS.good });
  if (isOfac) badges.push({ label: "OFAC", color: SVG_COLORS.critical });
  if (isToxicMerge) badges.push({ label: toxicLabel ?? "TOXIC", color: SVG_COLORS.critical });
  if (isUnconfirmed) badges.push({ label: unconfirmedLabel ?? "Unconfirmed", color: SVG_COLORS.medium });
  if (badges.length === 0) return null;

  const by = nodeY + 42;
  // Pre-compute badge positions (right-to-left) using a pure reduce
  const reversed = [...badges].reverse();
  const positioned = reversed.reduce<Array<Badge & { x: number; tw: number }>>((acc, b) => {
    const tw = b.label.length * 5.5 + 8;
    const prevX = acc.at(-1)?.x ?? nodeX + nodeWidth - 4 - rightInset;
    const x = prevX - tw - 2;
    acc.push({ ...b, x, tw });
    return acc;
  }, []);

  return (
    <g style={{ pointerEvents: "none" }}>
      {positioned.map((b) => (
        <g key={b.label} transform={`translate(${b.x}, ${by})`}>
          <rect width={b.tw} height={12} rx={6} fill={b.color} fillOpacity={0.2} stroke={b.color} strokeWidth={0.75} />
          <text x={b.tw / 2} y={9} textAnchor="middle" fontSize="7" fontWeight="bold" fill={SVG_COLORS.foreground}>{b.label}</text>
        </g>
      ))}
    </g>
  );
}
