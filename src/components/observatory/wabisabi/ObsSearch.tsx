"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ArrowRight, ArrowUpRight, Search, X } from "lucide-react";
import { parseSearch, resolveSearch, type SearchQuery, type SearchResult } from "@/lib/observatory/obs-search";
import type { Scene, SkyEvent } from "@/lib/observatory/sky-model";
import type { Period } from "@/lib/observatory/wabisator-client";
import { usePeriodLabel } from "./StatsStrip";

export interface ObsSearchProps {
  /** The loaded period's scene; null while it loads (the field stays usable, submit waits). */
  scene: Scene | null;
  period: Period;
  onFound: (event: SkyEvent) => void;
  onJumpTo: (t: number) => void;
  onSwitchPeriod: (p: Period) => void;
}

const LINK = "inline-flex min-h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-bitcoin-text transition-colors hover:text-bitcoin focus-visible:outline-2 focus-visible:outline-bitcoin cursor-pointer";

function AnalyzeLink({ txid }: { txid: string }) {
  const { t } = useTranslation();
  return (
    <a href={`/#tx=${txid}`} className={LINK}>
      {t("observatory.wabisabi.event.analyze", { defaultValue: "Analyze in am-i.exposed" })}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}

/**
 * A txid or date search over the loaded period, in the WabiSabi header. Everything resolves against
 * data already on the page: nothing is sent anywhere, not even for an unknown txid.
 */
export function ObsSearch({ scene, period, onFound, onJumpTo, onSwitchPeriod }: ObsSearchProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language || "en";
  const periodLabel = usePeriodLabel(period);
  const [value, setValue] = useState("");
  const [query, setQuery] = useState<SearchQuery | null>(null);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [ranAt, setRanAt] = useState(0);
  // A query queued until its period's data arrives (submitted while loading, or after a period switch).
  const [waiting, setWaiting] = useState(false);
  const suggestedLabel = usePeriodLabel(result?.kind === "out-of-period" && result.suggested ? result.suggested : period);
  const panelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const run = (q: SearchQuery, s: Scene) => {
    const now = Date.now() / 1000;
    let r = resolveSearch(q, s, now);
    // The period that would hold it is this one (a moment past the data's last refresh): clamp.
    if (r.kind === "out-of-period" && r.suggested === period) r = { kind: "in-period", t: Math.min(Math.max(r.t, s.since), s.until) };
    setRanAt(now);
    // Found: the map's pinned card and the ticker take over, so the panel stays closed.
    setResult(r.kind === "found" ? null : r);
    if (r.kind === "found") onFound(r.event);
    if (r.kind === "in-period") onJumpTo(r.t);
  };

  // Finish a search once its period's data is in: after switching to a suggested period, or when
  // submitted while the data was still loading.
  const pendingRef = useRef<{ q: SearchQuery; p: Period } | null>(null);
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || !scene || pending.p !== period) return;
    pendingRef.current = null;
    setWaiting(false);
    run(pending.q, scene);
    // run is recreated every render; the scene arriving is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, period]);

  // A popover: a press anywhere else dismisses it.
  const rootRef = useRef<HTMLDivElement>(null);
  const open = !!result || waiting;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) { setResult(null); setWaiting(false); } };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const submit = () => {
    const q = parseSearch(value);
    setQuery(q);
    pendingRef.current = null;
    setWaiting(false);
    if (q.kind === "invalid") setResult(q);
    else if (!scene) {
      pendingRef.current = { q, p: period };
      setWaiting(true);
      setResult(null);
    } else run(q, scene);
  };
  const clear = () => {
    pendingRef.current = null;
    setWaiting(false);
    setResult(null);
    setQuery(null);
    inputRef.current?.focus();
  };

  const date = (ts: number) => {
    const minute = query?.kind === "date" && query.span === 60;
    return `${new Date(ts * 1000).toLocaleString(locale, { timeZone: "UTC", year: "numeric", month: "short", day: "numeric", ...(minute ? { hour: "2-digit", minute: "2-digit" } : {}) })}${minute ? " UTC" : ""}`;
  };

  let body: ReactNode = null;
  if (result?.kind === "not-found") {
    body = (
      <div className="space-y-2">
        <p className="font-medium text-foreground text-pretty">
          {t("observatory.wabisabi.search.notFound", { defaultValue: "Not a recorded WabiSabi CoinJoin in the last {{period}}.", period: periodLabel })}
        </p>
        <p className="text-muted text-pretty">
          {t("observatory.wabisabi.search.notFoundNote", { defaultValue: "The search ran in this page: the txid was not sent anywhere. It can still be analyzed on its own." })}
        </p>
        <AnalyzeLink txid={result.txid} />
      </div>
    );
  } else if (result?.kind === "in-period") {
    body = (
      <p className="text-foreground text-pretty">
        {t("observatory.wabisabi.search.jumped", { defaultValue: "Replay moved to {{date}}.", date: date(result.t) })}
      </p>
    );
  } else if (result?.kind === "out-of-period") {
    const future = result.t > ranAt;
    body = result.suggested ? (
      <div className="space-y-1.5">
        <p className="text-foreground text-pretty">
          {t("observatory.wabisabi.search.outside", { defaultValue: "{{date}} is outside the last {{period}}.", date: date(result.t), period: periodLabel })}
        </p>
        <button
          type="button"
          className={LINK}
          onClick={() => {
            if (!query || !result.suggested) return;
            pendingRef.current = { q: query, p: result.suggested };
            setWaiting(true);
            setResult(null);
            onSwitchPeriod(result.suggested);
          }}
        >
          {t("observatory.wabisabi.search.switch", { defaultValue: "Show the last {{period}}", period: suggestedLabel })}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      </div>
    ) : (
      <p className="text-foreground text-pretty">
        {future
          ? t("observatory.wabisabi.search.future", { defaultValue: "{{date}} is in the future.", date: date(result.t) })
          : t("observatory.wabisabi.search.tooOld", { defaultValue: "{{date}} is more than 30 days ago. The Observatory covers the last 30 days.", date: date(result.t) })}
      </p>
    );
  } else if (result?.kind === "invalid") {
    body = (
      <p className="text-muted text-pretty">
        {t("observatory.wabisabi.search.invalid", { defaultValue: "Enter a 64-character txid, or a UTC date such as 2026-10-07 or 2026-10-07 14:30." })}
      </p>
    );
  }

  if (!body && waiting) {
    body = <p className="text-muted">{t("observatory.wabisabi.search.waiting", { defaultValue: "Waiting for data..." })}</p>;
  }

  return (
    <div
      ref={rootRef}
      className="relative w-full"
      onKeyDown={(e) => {
        if (e.key === "Escape" && (result || waiting)) {
          e.preventDefault();
          clear();
        }
      }}
    >
      <form
        role="search"
        aria-label={t("observatory.wabisabi.search.label", { defaultValue: "Search the Observatory" })}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="group flex h-11 items-center gap-1 rounded-lg border border-hairline bg-surface-1 pl-3 shadow-(--shadow-card) transition-[border-color,box-shadow] duration-200 focus-within:border-bitcoin focus-within:ring-4 focus-within:ring-bitcoin/15"
      >
        <Search size={16} aria-hidden="true" className="shrink-0 text-faint transition-colors group-focus-within:text-muted" />
        <input
          ref={inputRef}
          type="search"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (result) setResult(null);
          }}
          placeholder={t("observatory.wabisabi.search.placeholder", { defaultValue: "Search a CoinJoin txid or a date" })}
          aria-label={t("observatory.wabisabi.search.placeholder", { defaultValue: "Search a CoinJoin txid or a date" })}
          aria-controls={panelId}
          aria-describedby={result || waiting ? panelId : undefined}
          spellCheck={false}
          autoComplete="off"
          className="h-full min-w-0 flex-1 bg-transparent px-1.5 text-sm text-foreground placeholder:text-faint outline-none focus-visible:!outline-none focus-visible:!shadow-none [&::-webkit-search-cancel-button]:hidden"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          aria-label={t("observatory.wabisabi.search.submit", { defaultValue: "Search" })}
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-foreground disabled:opacity-40 disabled:hover:text-muted focus-visible:outline-2 focus-visible:outline-bitcoin cursor-pointer disabled:cursor-default"
        >
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </form>
      <div id={panelId} role="status" aria-live="polite" className="absolute inset-x-0 top-full z-[35] mt-2">
        {body && (
          <div
            key={result?.kind ?? "waiting"}
            data-testid="obs-search-result"
            data-state={result?.kind ?? "waiting"}
            className="relative rounded-xl border border-card-border bg-surface-elevated p-4 pr-12 text-sm shadow-(--overlay-shadow) motion-safe:animate-[obs-fade_180ms_ease-out]"
          >
            <button
              type="button"
              onClick={clear}
              aria-label={t("observatory.wabisabi.event.close", { defaultValue: "Close" })}
              className="absolute right-1 top-1 inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-bitcoin cursor-pointer"
            >
              <X size={16} aria-hidden="true" />
            </button>
            {body}
          </div>
        )}
      </div>
    </div>
  );
}
