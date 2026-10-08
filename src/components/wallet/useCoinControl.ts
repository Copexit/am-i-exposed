"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_MAX_ABSORB, outpointOf, PLAN_CRITERIA, type CoinSelectionInput, type PlanCriterion } from "@/lib/analysis/coin-selection";

/**
 * Coin control state shared by the UTXO list (manual selection) and the
 * Coin Selection Advisor: amount, fee rate, ranking criterion, selected coins.
 *
 * URL: `rank=<criterion>` (left out for Privacy first), `absorb=<sats>` (max
 * extra fee to leave no change, left out at the default) and
 * `coins=<txid:vout,...>` are kept in the hash next to `xpub=` while the
 * hash holds this wallet. They are written with replaceState and no
 * hashchange event, so the wallet is not scanned again. Nothing else is stored.
 */
export interface CoinControl {
  /** Coins of the loaded wallet, with labels (frozen included) */
  utxos: CoinSelectionInput[];
  amount: string;
  setAmount: (v: string) => void;
  feeRate: string;
  setFeeRate: (v: string) => void;
  criterion: PlanCriterion;
  setCriterion: (c: PlanCriterion) => void;
  /** Max extra fee (sats) to leave no change, as typed */
  maxAbsorb: string;
  setMaxAbsorb: (v: string) => void;
  /** Manual selection: pay small change to miners instead */
  absorb: boolean;
  setAbsorb: (on: boolean) => void;
  /** Selected outpoints that exist in this wallet */
  selected: ReadonlySet<string>;
  toggle: (outpoint: string, on: boolean) => void;
  clear: () => void;
  /** Bumped by "Compare with suggestions"; 0 when not comparing */
  compareSeq: number;
  compare: () => void;
}

const EMPTY: ReadonlySet<string> = new Set();
const KEY_RE = /^(rank|coins|absorb)=/;
const DEFAULT_ABSORB = String(DEFAULT_MAX_ABSORB);

/** Max extra fee as typed: empty or invalid means off (0). */
export const parseMaxAbsorb = (v: string) => { const n = Number(v); return v.trim() && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; };

/** The hash holds this wallet (the `xpub` key holds the key, bare or in a descriptor). */
function hashParams(xpub: string | null): URLSearchParams | null {
  if (!xpub || typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.get("xpub")?.includes(xpub) ? params : null;
}

function readHash(xpub: string | null): { criterion: PlanCriterion; outpoints: ReadonlySet<string>; maxAbsorb: string } {
  const params = hashParams(xpub);
  const rank = params?.get("rank");
  const coins = params?.get("coins");
  const absorb = params?.get("absorb");
  return {
    criterion: PLAN_CRITERIA.find(c => c === rank) ?? "privacy",
    outpoints: coins ? new Set(coins.split(",").filter(Boolean)) : EMPTY,
    maxAbsorb: absorb && /^\d{1,9}$/.test(absorb) ? absorb : DEFAULT_ABSORB,
  };
}

function writeHash(xpub: string, criterion: PlanCriterion, selected: ReadonlySet<string>, maxAbsorb: string): void {
  if (!hashParams(xpub)) return;
  const hash = window.location.hash.slice(1);
  // Other keys are kept byte for byte (their encoding is the scanner's).
  const parts = hash.split("&").filter(p => !KEY_RE.test(p));
  if (criterion !== "privacy") parts.push(`rank=${criterion}`);
  const absorb = parseMaxAbsorb(maxAbsorb);
  if (absorb !== DEFAULT_MAX_ABSORB) parts.push(`absorb=${absorb}`);
  if (selected.size > 0) parts.push(`coins=${[...selected].join(",")}`);
  const next = parts.join("&");
  if (next !== hash) window.history.replaceState(window.history.state, "", `#${next}`);
}

/** `xpub` null: no URL state (a selector on its own). */
export function useCoinControl(xpub: string | null, utxos: CoinSelectionInput[]): CoinControl {
  const [amount, setAmount] = useState("");
  const [feeRate, setFeeRate] = useState("5");
  const [initial] = useState(() => readHash(xpub));
  const [criterion, setCriterion] = useState(initial.criterion);
  const [maxAbsorb, setMaxAbsorb] = useState(initial.maxAbsorb);
  const [absorb, setAbsorb] = useState(false);
  // The selection belongs to one wallet: another xpub starts empty.
  const [sel, setSel] = useState({ xpub, outpoints: initial.outpoints });
  const [compareSeq, setCompareSeq] = useState(0);

  const own = sel.xpub === xpub ? sel.outpoints : EMPTY;
  const selected = useMemo(() => {
    if (own.size === 0) return EMPTY;
    const kept = new Set(utxos.map(outpointOf).filter(op => own.has(op)));
    return kept.size === 0 ? EMPTY : kept;
  }, [own, utxos]);

  useEffect(() => { if (xpub) writeHash(xpub, criterion, selected, maxAbsorb); }, [xpub, criterion, selected, maxAbsorb]);

  return {
    utxos, amount, setAmount, feeRate, setFeeRate, criterion, setCriterion, maxAbsorb, setMaxAbsorb, absorb, setAbsorb, selected, compareSeq,
    toggle: (op, on) => setSel(s => {
      const next = new Set(s.xpub === xpub ? s.outpoints : EMPTY);
      if (on) next.add(op);
      else next.delete(op);
      return { xpub, outpoints: next };
    }),
    clear: () => { setSel({ xpub, outpoints: EMPTY }); setCompareSeq(0); },
    compare: () => setCompareSeq(n => n + 1),
  };
}
