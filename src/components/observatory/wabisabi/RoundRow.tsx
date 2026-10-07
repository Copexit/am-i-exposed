"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { RotateCcw } from "lucide-react";
import { PHASES, countdownLabel, type BoardRound } from "@/lib/observatory/board";
import { fmtCount } from "@/lib/observatory/obs-format";

// ---------- the board's shared 1 s clock ----------

const NowContext = createContext<number>(0);

/**
 * One 1 s interval for the whole board. `children` are created by the parent, so a tick
 * re-renders only the components that read `useNow()`, never the cards around them.
 */
export function NowProvider({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Paused while the page is hidden; resyncs at once when it is visible again.
    let id: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(id);
      id = undefined;
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      id = setInterval(() => setNow(Date.now()), 1000);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", sync); };
  }, []);
  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export const useNow = () => useContext(NowContext);

/** 65 -> "1:05", 3725 -> "1:02:05". */
export function fmtClock(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/** Time left in input registration. Unknown renders nothing; past due renders a calm "closing". */
function Countdown({ closesAt }: { closesAt: number | null }) {
  const { t } = useTranslation();
  const c = countdownLabel(closesAt, useNow());
  if (c.kind === "unknown") return null;
  if (c.kind === "closing") return <span className="text-xs text-muted">{t("observatory.wabisabi.live.closing", { defaultValue: "closing" })}</span>;
  return (
    <span className="num text-sm text-foreground">
      <span className="sr-only">{t("observatory.wabisabi.live.closesIn", { defaultValue: "Input registration closes in" })} </span>
      {fmtClock(c.seconds)}
    </span>
  );
}

// ---------- the row ----------

export function usePhaseLabel(): (phase: string) => string {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    InputRegistration: t("observatory.wabisabi.phase.inputRegistration", { defaultValue: "Input registration" }),
    ConnectionConfirmation: t("observatory.wabisabi.phase.connectionConfirmation", { defaultValue: "Connection confirmation" }),
    OutputRegistration: t("observatory.wabisabi.phase.outputRegistration", { defaultValue: "Output registration" }),
    TransactionSigning: t("observatory.wabisabi.phase.transactionSigning", { defaultValue: "Signing" }),
    Ended: t("observatory.wabisabi.phase.ended", { defaultValue: "Ended" }),
  };
  return (phase) => labels[phase] ?? phase;
}

/**
 * One round: a 5-step phase indicator, inputs against the minimum to start (the bar rescales
 * past the minimum and tints the overflow) and the input-registration countdown.
 */
export function RoundRow({ round, color }: { round: BoardRound; color: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const phaseLabel = usePhaseLabel();
  const { inputs, min, phaseIndex } = round;
  const ended = phaseIndex === PHASES.length - 1;
  const scale = Math.max(min, inputs, 1);
  const filled = Math.min(inputs, min) / scale;
  const over = min > 0 && inputs > min ? (inputs - min) / scale : 0;
  const count = min > 0 ? `${fmtCount(inputs, locale)} / ${fmtCount(min, locale)}` : fmtCount(inputs, locale);
  const bar = "absolute inset-y-0 rounded-full motion-safe:transition-[left,width] motion-safe:duration-700 motion-safe:ease-out";

  return (
    <div className={`space-y-2.5 py-3.5 ${ended ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ol aria-hidden="true" className="flex items-center gap-1">
          {PHASES.map((p, i) => (
            <li
              key={p}
              className={`h-1.5 rounded-full motion-safe:transition-all motion-safe:duration-500 ${i === phaseIndex ? "w-5" : "w-2.5"} ${i > phaseIndex ? "border border-hairline-strong" : ""}`}
              style={i < phaseIndex ? { background: `color-mix(in srgb, ${color} 45%, transparent)` } : i === phaseIndex ? { background: color } : undefined}
            />
          ))}
        </ol>
        <span className="text-sm text-foreground">
          {phaseLabel(round.phase)}
          {phaseIndex >= 0 && (
            <span className="sr-only">
              {" "}{t("observatory.wabisabi.live.step", { defaultValue: "(step {{step}} of {{total}})", step: phaseIndex + 1, total: PHASES.length })}
            </span>
          )}
        </span>
        {round.blame && (
          <span className="inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
            <RotateCcw size={11} aria-hidden="true" />
            {t("observatory.wabisabi.live.blame", { defaultValue: "Blame round" })}
          </span>
        )}
        <span className="ml-auto">{phaseIndex <= 0 && <Countdown closesAt={round.closesAt} />}</span>
      </div>
      <div className="flex items-center gap-3">
        {/* Unknown minimum (0): no track, only the count. */}
        {min > 0 && (
          <div aria-hidden="true" className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span className={`${bar} left-0`} style={{ width: `${filled * 100}%`, background: color }} />
            <span className={bar} style={{ left: `${(min / scale) * 100}%`, width: `${over * 100}%`, background: `color-mix(in srgb, ${color} 40%, transparent)` }} />
            {/* The minimum, as a cut in the bar: legible on any coordinator colour and on faded Ended rows. */}
            {over > 0 && <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-surface-1 motion-safe:transition-[left] motion-safe:duration-700 motion-safe:ease-out" style={{ left: `${(min / scale) * 100}%` }} />}
          </div>
        )}
        <span className={`num shrink-0 text-xs ${min > 0 ? "" : "ml-auto"} ${min > 0 && inputs >= min ? "text-foreground" : "text-muted"}`}>
          <span aria-hidden="true">{count}</span>
          <span className="sr-only">
            {min > 0
              ? t("observatory.wabisabi.live.inputsOfMin", { defaultValue: "{{inputs}} inputs, {{min}} needed to start", count: inputs, inputs: fmtCount(inputs, locale), min: fmtCount(min, locale) })
              : t("observatory.wabisabi.live.inputs", { defaultValue: "{{inputs}} inputs", count: inputs, inputs: fmtCount(inputs, locale) })}
            {over > 0 && `, ${t("observatory.wabisabi.live.overMin", { defaultValue: "{{extra}} above the minimum", extra: fmtCount(inputs - min, locale) })}`}
          </span>
        </span>
      </div>
    </div>
  );
}
