"use client";

import { SVG_COLORS } from "../shared/svgConstants";

interface Badge {
  label: string;
  bg: string;
  fg: string;
}

interface NodeBadgesProps {
  nodeX: number;
  nodeY: number;
  nodeWidth: number;
  isCoinJoin: boolean;
  coinJoinType?: string;
  isOfac?: boolean;
  isToxicMerge: boolean;
  isUnconfirmed?: boolean;
  unconfirmedLabel?: string;
}

export function NodeBadges({
  nodeX,
  nodeY,
  nodeWidth,
  isCoinJoin,
  coinJoinType,
  isOfac,
  isToxicMerge,
  isUnconfirmed,
  unconfirmedLabel,
}: NodeBadgesProps) {
  const badges: Badge[] = [];
  if (isCoinJoin) badges.push({ label: coinJoinType ?? "CJ", bg: SVG_COLORS.good, fg: SVG_COLORS.background });
  if (isOfac) badges.push({ label: "OFAC", bg: SVG_COLORS.critical, fg: SVG_COLORS.background });
  if (isToxicMerge) badges.push({ label: "TOXIC", bg: "#ef4444", fg: SVG_COLORS.background });
  if (isUnconfirmed) badges.push({ label: unconfirmedLabel ?? "Unconfirmed", bg: SVG_COLORS.medium, fg: SVG_COLORS.background });
  if (badges.length === 0) return null;

  const by = nodeY + 42;
  // Pre-compute badge positions (right-to-left) using a pure reduce
  const reversed = [...badges].reverse();
  const positioned = reversed.reduce<Array<Badge & { x: number; tw: number }>>((acc, b) => {
    const tw = b.label.length * 5.5 + 8;
    const prevX = acc.length > 0 ? acc[acc.length - 1].x : nodeX + nodeWidth - 4;
    const x = prevX - tw - 2;
    acc.push({ ...b, x, tw });
    return acc;
  }, []);

  return (
    <g style={{ pointerEvents: "none" }}>
      {positioned.map((b) => (
        <g key={b.label} transform={`translate(${b.x}, ${by})`}>
          <rect width={b.tw} height={12} rx={6} fill={b.bg} fillOpacity={0.3} stroke={b.bg} strokeWidth={0.5} strokeOpacity={0.6} />
          <text x={b.tw / 2} y={9} textAnchor="middle" fontSize="7" fontWeight="bold" fill={b.fg} fillOpacity={0.85}>{b.label}</text>
        </g>
      ))}
    </g>
  );
}
