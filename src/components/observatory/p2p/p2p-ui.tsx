"use client";

import { Fragment, type ReactNode } from "react";
import type { Venue } from "@/lib/observatory/p2p/types";
import { venueFgVar } from "@/lib/observatory/p2p/venue-palette";

export const FADE = "motion-safe:animate-[obs-fade_250ms_ease-out]";
export const BONE = "rounded bg-surface-2 motion-safe:animate-pulse";
export const CHIP = "inline-flex items-center gap-2 min-h-10 px-3 rounded-lg text-sm whitespace-nowrap transition-colors duration-200 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bitcoin";
export const CHIP_ON = "bg-surface-elevated text-foreground shadow-sm ring-1 ring-hairline-strong";
export const CHIP_OFF = "text-muted hover:text-foreground";
export const DASH = "–";

/** A value passed to t() as a marker, so the translated sentence can wrap it in markup. */
export const mark = (name: string) => `\u0001${name}\u0001`;

/** Splits a t() result on the markers from `mark()` and puts each node in place. */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text.split(/\u0001(\w+)\u0001/).map((part, i) => (i % 2 ? <Fragment key={i}>{nodes[part]}</Fragment> : part));
}

/** Venue names are not translated. */
export const VENUE_LABEL: Record<Venue, string> = { robosats: "RoboSats", mostro: "Mostro", hodlhodl: "HodlHodl" };

export function VenueDot({ venue, color, className = "size-2" }: { venue?: Venue; color?: string; className?: string }) {
  return <span aria-hidden="true" className={`${className} shrink-0 rounded-full`} style={{ background: color ?? (venue ? venueFgVar(venue) : undefined) }} />;
}
