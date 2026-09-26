"use client";

import { useTranslation } from "react-i18next";
import { GRADE_HEX } from "@/lib/constants";
import { scoreToGrade } from "@/lib/scoring/score";
import type { Grade } from "@/lib/types";

/** Grade band lower bounds (scoreToGrade in src/lib/scoring/score.ts). */
const BANDS: { grade: Grade; from: number; to: number }[] = [
  { grade: "F", from: 0, to: 25 },
  { grade: "D", from: 25, to: 50 },
  { grade: "C", from: 50, to: 75 },
  { grade: "B", from: 75, to: 90 },
  { grade: "A+", from: 90, to: 100 },
];

const R = 86;
const CX = 100;
const CY = 100;
const START = Math.PI; // 180deg (left)

function point(score: number, r = R): [number, number] {
  const a = START - (score / 100) * Math.PI;
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)];
}

function arc(from: number, to: number, r = R): string {
  const [x1, y1] = point(from, r);
  const [x2, y2] = point(to, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
}

/**
 * Half-circle score gauge with the five grade bands. `score` is what is shown
 * now (animated during the reveal); the grade letter follows it, so it steps
 * through the bands honestly as the running total moves.
 */
export function GradeDial({ score, size = 220 }: { score: number; size?: number }) {
  const { t } = useTranslation();
  const grade = scoreToGrade(score);
  const color = GRADE_HEX[grade];
  const [nx, ny] = point(score);
  return (
    <div className="relative" style={{ width: size, height: size * 0.62 }}>
      <svg viewBox="0 0 200 124" width={size} height={size * 0.62} aria-hidden="true" className="overflow-visible">
        {BANDS.map((b) => (
          <path key={b.grade} d={arc(b.from + 0.6, b.to - 0.6)} fill="none" stroke={GRADE_HEX[b.grade]} strokeOpacity={b.grade === grade ? 0.28 : 0.1} strokeWidth={10} strokeLinecap="butt" />
        ))}
        <path d={arc(0, Math.max(0.01, score))} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />
        {BANDS.slice(1).map((b) => {
          const [x1, y1] = point(b.from, R + 9);
          const [x2, y2] = point(b.from, R + 14);
          return <line key={b.grade} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--faint)" strokeWidth={1} />;
        })}
        {BANDS.map((b) => {
          const [x, y] = point((b.from + b.to) / 2, R + 24);
          return (
            <text key={b.grade} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill={b.grade === grade ? GRADE_HEX[b.grade] : "var(--faint)"} fontFamily="var(--font-geist-mono)">
              {b.grade}
            </text>
          );
        })}
        <circle cx={nx} cy={ny} r={6.5} fill="var(--background)" stroke={color} strokeWidth={3} />
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="font-semibold tracking-tighter leading-none" style={{ color, fontSize: size * 0.3 }}>{grade}</span>
        <span className="v2-num text-sm text-muted mt-1" aria-label={t("score.ariaLabel", { score, grade, defaultValue: "Privacy score: {{score}} out of 100, grade {{grade}}" })}>
          <span className="text-foreground">{score}</span>
          <span className="text-faint"> / 100</span>
        </span>
      </div>
    </div>
  );
}
