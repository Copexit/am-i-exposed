import type { CoordinatorsStatus, StatusCoordinator } from "./wabisator-types";
import { safeHttpUrl } from "./obs-format";

export const PHASES: readonly string[] = ["InputRegistration", "ConnectionConfirmation", "OutputRegistration", "TransactionSigning", "Ended"];

export interface BoardRound { id: string; phase: string; phaseIndex: number; inputs: number; min: number; progress: number; closesAt: number | null; blame: boolean }
export interface BoardCard { key: string; name: string; online: boolean; fees: string; readMore: string; rules: { label: string; value: string }[]; volume24h: number; coinjoins24h: number; rounds: BoardRound[] }

/** Config keys shown as rules, in display order. Labels are the raw Wabisator keys; the UI translates them. */
const RULE_KEYS = ["Minimum Inputs", "Allowed Input Types", "Allowed Input Amounts", "Mining Fee Rate"];

/** "0d 0h 1m 5s" -> 65. Components may be negative ("0d 0h -1m -51s"). Unparseable -> null. */
export function parseRemaining(s: string): number | null {
  const m = /^\s*(-?\d+)d\s+(-?\d+)h\s+(-?\d+)m\s+(-?\d+)s\s*$/.exec(s);
  if (!m) return null;
  const [d, h, min, sec] = m.slice(1).map(Number) as [number, number, number, number];
  return d * 86400 + h * 3600 + min * 60 + sec;
}

/** Minimum inputs to start a round; 0 means unknown (the UI then shows the raw count). */
function minInputs(c: StatusCoordinator): number {
  if (c.AbsoluteMinInputCount != null) return c.AbsoluteMinInputCount;
  const v = c.Config?.["Minimum Inputs"];
  return typeof v === "number" ? v : 0;
}

function card(c: StatusCoordinator, receivedAt: number): BoardCard {
  const min = minInputs(c);
  return {
    key: c.Key,
    name: c.Name,
    online: c.Status === "Online",
    fees: c.Fees,
    readMore: safeHttpUrl(c.ReadMore) ?? "",
    rules: RULE_KEYS.filter((k) => c.Config?.[k] != null).map((k) => ({ label: k, value: String(c.Config?.[k]) })),
    volume24h: c.Volume24h,
    coinjoins24h: c.Coinjoins24h,
    rounds: c.RoundStates.map((r) => {
      const remaining = parseRemaining(r.InputRegistrationRemaining);
      return {
        id: r.RoundId,
        phase: r.Phase,
        phaseIndex: PHASES.indexOf(r.Phase),
        inputs: r.InputCount,
        min,
        progress: min > 0 ? Math.min(1, r.InputCount / min) : 0,
        closesAt: remaining == null ? null : receivedAt + remaining * 1000,
        blame: r.IsBlameRound,
      };
    }),
  };
}

/**
 * `receivedAt` is the ms timestamp the status arrived. Countdowns count from the snapshot's own
 * `UpdatedAt` when it parses (a cached snapshot can be ~25 s old), never later than receipt.
 * Active = online with 24 h volume or open rounds.
 */
export function buildBoard(status: CoordinatorsStatus, receivedAt: number): { active: BoardCard[]; inactive: BoardCard[] } {
  const updated = Date.parse(status.UpdatedAt);
  const anchor = Number.isFinite(updated) ? Math.min(updated, receivedAt) : receivedAt;
  const cards = status.Coordinators.map((c) => card(c, anchor)).sort((a, b) => b.volume24h - a.volume24h);
  const isActive = (c: BoardCard) => c.online && (c.volume24h > 0 || c.rounds.length > 0);
  return { active: cards.filter(isActive), inactive: cards.filter((c) => !isActive(c)) };
}

export function countdownLabel(closesAt: number | null, now: number): { kind: "time"; seconds: number } | { kind: "closing" } | { kind: "unknown" } {
  if (closesAt == null) return { kind: "unknown" };
  const seconds = Math.ceil((closesAt - now) / 1000);
  return seconds > 0 ? { kind: "time", seconds } : { kind: "closing" };
}
