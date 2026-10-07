"use client";

import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import type { Scene } from "@/lib/observatory/sky-model";
import { coordinatorColorVar, coordinatorFgVar } from "@/lib/observatory/coordinator-palette";
import { fmtBtc, fmtCount } from "@/lib/observatory/obs-format";
import { TXID_RE } from "@/lib/constants";

export interface TickerProps {
  scene: Scene;
  /** Replay time in seconds; Infinity when live. */
  time: number;
  highlightTx: string | null;
  onSelect: (txid: string | null) => void;
  /** "sky" sits on the map (light text on ink in both themes); "page" sits on the page background. */
  tone: "sky" | "page";
  withDate: boolean;
  reduced: boolean;
}

const ROWS = 6;

const TONES = {
  sky: { head: "!text-(--obs-sky-fg)/55", name: "text-(--obs-sky-fg)/90", meta: "text-(--obs-sky-fg)/50", row: "hover:bg-(--obs-sky-fg)/6", on: "bg-(--obs-sky-fg)/8 ring-1 ring-(--obs-sky-fg)/15", link: "text-bitcoin hover:text-(--obs-sky-fg)" },
  page: { head: "", name: "text-foreground", meta: "text-muted", row: "hover:bg-surface-2", on: "bg-surface-2 ring-1 ring-hairline-strong", link: "text-bitcoin-text hover:text-bitcoin" },
};

/** The latest CoinJoins up to the replay clock, newest first; a click pins one and offers the analysis. */
export function Ticker({ scene, time, highlightTx, onSelect, tone, withDate, reduced }: TickerProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const c = TONES[tone];
  let end = scene.events.length;
  while (end > 0 && scene.events[end - 1]!.t > time) end--;
  const rows = scene.events.slice(Math.max(0, end - ROWS), end).reverse();
  const names = new Map(scene.stars.map((s) => [s.key, s.name]));
  const clock = (sec: number) =>
    new Date(sec * 1000).toLocaleString(locale, withDate ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return (
    <section aria-labelledby={`obs-ticker-${tone}`} className="space-y-2">
      <h3 id={`obs-ticker-${tone}`} className={`eyebrow px-2.5 ${c.head}`}>
        {t("observatory.wabisabi.ticker.title", { defaultValue: "Latest CoinJoins" })}
      </h3>
      {rows.length === 0 ? (
        <p className={`px-2.5 text-sm ${c.meta}`}>{t("observatory.wabisabi.ticker.empty", { defaultValue: "No CoinJoins yet at this point of the replay." })}</p>
      ) : (
        <ol className="space-y-0.5">
          <AnimatePresence initial={false}>
            {rows.map((e) => {
              const on = e.txid === highlightTx;
              return (
                <motion.li
                  key={e.txid}
                  initial={reduced ? false : { opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  // No layout animation and instant exits: a fast replay adds rows faster than they could glide.
                  exit={{ opacity: 0, transition: { duration: 0 } }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                >
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => onSelect(on ? null : e.txid)}
                    className={`grid w-full min-h-11 grid-cols-[auto_1fr_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg px-2.5 py-2 text-left transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin ${on ? c.on : c.row}`}
                  >
                    <span aria-hidden="true" className="size-2 rounded-full" style={{ background: tone === "sky" ? coordinatorColorVar(e.star) : coordinatorFgVar(e.star) }} />
                    <span className={`truncate text-sm ${c.name}`}>{names.get(e.star) ?? e.star}</span>
                    <span className={`num text-sm ${c.name}`}>{fmtBtc(e.volume, locale)} <span className={c.meta}>BTC</span></span>
                    <span className={`num col-start-2 col-span-2 truncate text-[11px] ${c.meta}`}>
                      {e.analyzed
                        ? t("observatory.wabisabi.ticker.meta", {
                            defaultValue: "{{time}} · {{inputs}} inputs · anonset {{anonset}}",
                            time: clock(e.t),
                            inputs: fmtCount(e.inputs, locale),
                            anonset: e.anonset.toLocaleString(locale, { maximumFractionDigits: 1 }),
                          })
                        : `${clock(e.t)} · ${t("observatory.wabisabi.event.notAnalyzed", { defaultValue: "Not analysed yet" })}`}
                    </span>
                  </button>
                  {on && TXID_RE.test(e.txid) && (
                    <a href={`/#tx=${e.txid}`} className={`ml-[26px] inline-flex min-h-10 items-center gap-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-bitcoin ${c.link}`}>
                      {t("observatory.wabisabi.event.analyze", { defaultValue: "Analyze in am-i.exposed" })}
                      <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}
