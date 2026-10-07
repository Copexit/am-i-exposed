"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowUpRight, ChevronDown, Radio } from "lucide-react";
import { buildBoard, type BoardCard } from "@/lib/observatory/board";
import { coordinatorFgVar } from "@/lib/observatory/coordinator-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import type { Polled } from "@/hooks/useWabisator";
import type { CoordinatorsStatus } from "@/lib/observatory/wabisator-types";
import { ObservatoryErrorState } from "@/components/observatory/ObservatoryErrorState";
import { NowProvider, RoundRow, useNow } from "./RoundRow";
import { useReducedMotion } from "./SkyMap";

export interface LiveBoardProps {
  /** The tab's coordinators-status poll, shared so the board adds no request of its own. */
  status: Polled<CoordinatorsStatus>;
  onOpenCoordinator: (key: string) => void;
  /** Shown while the first status has not arrived. */
  skeleton: ReactNode;
}

const EASE = [0.22, 1, 0.36, 1] as const;
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin";

function useRuleLabel(): (raw: string) => string {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    "Minimum Inputs": t("observatory.wabisabi.rule.minInputs", { defaultValue: "Min inputs" }),
    "Allowed Input Types": t("observatory.wabisabi.rule.inputTypes", { defaultValue: "Input types" }),
    "Allowed Input Amounts": t("observatory.wabisabi.rule.amounts", { defaultValue: "Amounts" }),
    "Mining Fee Rate": t("observatory.wabisabi.rule.miningFee", { defaultValue: "Mining fee" }),
  };
  // board.ts only passes its RULE_KEYS, all mapped above; the raw label is the type-safe default.
  return (raw) => labels[raw] ?? raw;
}

function Refreshed({ at }: { at: number | null }) {
  const { t } = useTranslation();
  const now = useNow();
  if (at == null) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  return (
    <span className="num text-xs text-muted">
      {t("observatory.wabisabi.live.refreshed", { defaultValue: "Refreshed {{seconds}} s ago", seconds })}
    </span>
  );
}

function StatusDot({ online }: { online: boolean }) {
  return (
    <span aria-hidden="true" className="relative inline-flex size-2.5 shrink-0">
      {online && <span className="absolute inset-0 rounded-full bg-success motion-safe:animate-[obs-breathe_3s_ease-in-out_infinite]" />}
      <span className={`relative size-2.5 rounded-full ${online ? "bg-success" : "bg-faint"}`} />
    </span>
  );
}

function Card({ card, onOpen, reduced }: { card: BoardCard; onOpen: (key: string) => void; reduced: boolean }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const ruleLabel = useRuleLabel();
  const color = coordinatorFgVar(card.key);
  const chips = [{ label: t("observatory.wabisabi.rule.fees", { defaultValue: "Fees" }), value: card.fees }, ...card.rules.map((r) => ({ label: ruleLabel(r.label), value: r.value }))];

  return (
    <article
      aria-labelledby={`obs-live-${card.key}`}
      className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card) motion-safe:animate-[obs-fade_300ms_ease-out]"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <div className="space-y-4 p-4 pl-5 sm:p-5 sm:pl-6">
        <header className="flex items-start justify-between gap-3">
          <h3 id={`obs-live-${card.key}`} className="flex min-h-10 items-center gap-2.5 text-base font-semibold tracking-tight text-foreground text-balance">
            <StatusDot online={card.online} />
            {card.name}
          </h3>
          {card.readMore && (
            <a
              href={card.readMore}
              target="_blank"
              rel="noopener noreferrer"
              className={`-mr-2 inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted transition-colors duration-200 hover:text-foreground ${FOCUS}`}
            >
              {t("observatory.wabisabi.live.readMore", { defaultValue: "Website" })}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          )}
        </header>

        <div>
          <p className="flex items-baseline gap-1.5">
            <span className="num text-3xl leading-none tracking-tight text-foreground">{fmtBtc(card.volume24h, locale)}</span>
            <span className="num text-xs text-muted">BTC</span>
          </p>
          <p className="mt-1.5 text-xs text-muted">
            <span className="num text-foreground">{fmtCount(card.coinjoins24h, locale)}</span>{" "}
            {t("observatory.wabisabi.live.coinjoins24h", { defaultValue: "CoinJoins in 24 h" })}
          </p>
        </div>
      </div>

      <div className="px-4 pl-5 sm:px-5 sm:pl-6">
        <h4 className="eyebrow border-t border-hairline pt-3.5">
          {t("observatory.wabisabi.live.rounds", { defaultValue: "Rounds" })} <span className="num">{card.rounds.length}</span>
        </h4>
        {card.rounds.length === 0 && (
          <p className="py-3.5 text-sm text-muted motion-safe:animate-[obs-fade_300ms_ease-out]">{t("observatory.wabisabi.live.noRounds", { defaultValue: "No round open right now." })}</p>
        )}
        {/* Always mounted, so the first round fades in and the last one fades out. */}
        <ul className="divide-y divide-hairline">
          <AnimatePresence initial={false}>
            {card.rounds.map((r) => (
              <motion.li
                key={r.id}
                layout={reduced ? false : "position"}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, overflow: "hidden" }}
                transition={{ duration: 0.45, ease: EASE }}
              >
                <RoundRow round={r} color={color} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>

      <div className="px-4 pb-4 pl-5 pt-1 sm:px-5 sm:pl-6">
        <ul className="flex flex-wrap gap-1.5" aria-label={t("observatory.wabisabi.live.rules", { defaultValue: "Rules" })}>
          {chips.map((c) => (
            <li key={c.label} className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-md border border-hairline bg-surface-inset px-2 py-1 text-[11px] leading-snug">
              <span className="text-muted">{c.label}</span>
              <span className="text-foreground">{c.value}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto border-t border-hairline px-2 py-1.5 sm:px-3">
        <button
          type="button"
          onClick={() => onOpen(card.key)}
          className={`group inline-flex min-h-10 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-sm text-foreground transition-colors duration-200 hover:bg-surface-2 cursor-pointer ${FOCUS}`}
        >
          {t("observatory.wabisabi.live.open", { defaultValue: "History and rounds" })}
          <ArrowRight size={15} aria-hidden="true" className="text-muted transition-transform duration-200 motion-safe:group-hover:translate-x-0.5" />
        </button>
      </div>
    </article>
  );
}

function Inactive({ cards, onOpen }: { cards: BoardCard[]; onOpen: (key: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (cards.length === 0) return null;
  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors duration-200 hover:bg-surface-2 hover:text-foreground cursor-pointer ${FOCUS}`}
      >
        <ChevronDown size={15} aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        {open
          ? t("observatory.wabisabi.live.hideInactive", { defaultValue: "Hide {{count}} inactive", count: cards.length })
          : t("observatory.wabisabi.live.showInactive", { defaultValue: "Show {{count}} inactive", count: cards.length })}
      </button>
      {open && (
        <ul id={listId} className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 motion-safe:animate-[obs-fade_250ms_ease-out]">
          {cards.map((c) => (
            <li key={c.key}>
              <button
                type="button"
                onClick={() => onOpen(c.key)}
                className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg border border-hairline px-3 py-2 text-left transition-colors duration-200 hover:bg-surface-2 cursor-pointer ${FOCUS}`}
              >
                <span aria-hidden="true" className="size-2 shrink-0 rounded-full opacity-60" style={{ background: coordinatorFgVar(c.key) }} />
                <span className="min-w-0 flex-1 text-sm text-foreground text-balance">{c.name}</span>
                <span className="shrink-0 text-xs text-muted">
                  {c.online
                    ? t("observatory.wabisabi.live.idle", { defaultValue: "No activity in 24 h" })
                    : t("observatory.wabisabi.live.offline", { defaultValue: "Offline" })}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Live rounds: one card per active coordinator, sorted by 24 h volume, inactive ones behind a toggle. */
export function LiveBoard({ status, onOpenCoordinator, skeleton }: LiveBoardProps) {
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  // usePolled sets data and updatedAt together; countdowns are relative to when the status arrived.
  const board = useMemo(() => (status.data && status.updatedAt != null ? buildBoard(status.data, status.updatedAt) : null), [status.data, status.updatedAt]);

  if (!board) {
    return status.error
      ? <ObservatoryErrorState source="wabisator" onRetry={status.refresh} locale={i18n.language || "en"} />
      : <>{skeleton}</>;
  }
  // The same count as the card headers add up to.
  const rounds = board.active.reduce((n, c) => n + c.rounds.length, 0);

  return (
    <NowProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-2">
            <Radio size={14} aria-hidden="true" className="text-success" />
            {t("observatory.wabisabi.live.summary", { defaultValue: "Active coordinators: {{coordinators}} · Rounds: {{rounds}}", coordinators: board.active.length, rounds })}
          </span>
          <Refreshed at={status.updatedAt} />
        </div>
        {board.active.length === 0 ? (
          <div className="rounded-xl border border-hairline bg-surface-1 px-5 py-10 text-center">
            <p className="text-sm text-muted text-balance">{t("observatory.wabisabi.live.empty", { defaultValue: "No coordinator is running rounds right now. The board updates on its own." })}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {board.active.map((c) => <Card key={c.key} card={c} onOpen={onOpenCoordinator} reduced={reduced} />)}
          </div>
        )}
        <Inactive cards={board.inactive} onOpen={onOpenCoordinator} />
      </div>
    </NowProvider>
  );
}
