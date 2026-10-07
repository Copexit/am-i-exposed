"use client";

import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { SourceStatus } from "@/hooks/useP2p";
import { NowProvider, useNow } from "@/components/observatory/wabisabi/RoundRow";

const DOT: Record<SourceStatus["state"], string> = {
  ok: "bg-success",
  partial: "bg-warning",
  stale: "bg-warning opacity-60",
  down: "bg-severity-critical opacity-80",
  loading: "bg-faint motion-safe:animate-pulse",
};

function useAgo(): (ms: number) => string {
  const { i18n } = useTranslation();
  const now = useNow();
  const rtf = new Intl.RelativeTimeFormat(i18n.language || "en", { numeric: "auto", style: "narrow" });
  return (ms) => {
    const s = Math.max(0, Math.round((now - ms) / 1000));
    return s < 60 ? rtf.format(-s, "second") : s < 3600 ? rtf.format(-Math.floor(s / 60), "minute") : rtf.format(-Math.floor(s / 3600), "hour");
  };
}

function Chip({ source }: { source: SourceStatus }) {
  const { t } = useTranslation();
  const ago = useAgo();
  const id = useId();
  const label = {
    robosats: t("observatory.p2p.sources.robosats", { defaultValue: "RoboSats federation" }),
    mostro: t("observatory.p2p.sources.mostro", { defaultValue: "Mostro relays" }),
    hodlhodl: t("observatory.p2p.sources.hodlhodl", { defaultValue: "HodlHodl" }),
    index: t("observatory.p2p.sources.index", { defaultValue: "Index" }),
  }[source.id];
  const state = {
    ok: null,
    partial: t("observatory.p2p.sources.partial", { defaultValue: "partial" }),
    stale: t("observatory.p2p.sources.stale", { defaultValue: "stale" }),
    down: t("observatory.p2p.sources.down", { defaultValue: "down" }),
    loading: t("observatory.p2p.sources.loading", { defaultValue: "loading" }),
  }[source.state];
  const detail = [
    ...source.detail,
    ...(source.rejected > 0 ? [t("observatory.p2p.sources.rejected", { defaultValue: "{{count}} events failed verification", count: source.rejected })] : []),
  ];
  const when = source.updatedAt !== null && source.state !== "down" && source.state !== "loading" ? ago(source.updatedAt) : null;
  return (
    <li
      data-testid={`p2p-source-${source.id}`}
      data-state={source.state}
      title={detail.length ? detail.join("\n") : undefined}
      aria-describedby={detail.length ? id : undefined}
      className="relative inline-flex shrink-0 items-center gap-2 min-h-8 rounded-full border border-hairline bg-surface-1/60 pl-2.5 pr-3 text-xs text-muted"
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[source.state]}`} />
      <span className="text-foreground">{label}</span>
      {state && <span className={source.state === "down" ? "text-severity-critical" : source.state === "loading" ? "" : "text-warning"}>{state}</span>}
      {when && <span className="num text-faint">{when}</span>}
      {detail.length > 0 && <span id={id} className="sr-only">{detail.join(", ")}</span>}
    </li>
  );
}

/** One chip per source with a calm status dot and "updated Ns ago" (one shared 1 s clock). */
export function SourceStrip({ sources }: { sources: SourceStatus[] }) {
  const { t } = useTranslation();
  return (
    <NowProvider>
      <ul
        aria-label={t("observatory.p2p.sources.label", { defaultValue: "Data sources" })}
        className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0"
      >
        {sources.map((s) => <Chip key={s.id} source={s} />)}
      </ul>
    </NowProvider>
  );
}
