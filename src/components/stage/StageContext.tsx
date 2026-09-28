"use client";

import { createContext, useContext } from "react";

export interface StageCtx {
  /** Localized title of an engine finding (as FindingCard shows it), or null if the finding is unknown. */
  findingTitle: (findingId: string) => string | null;
  onFindingClick?: (findingId: string) => void;
  /** Rescan a related transaction (co-spent child, shared parent). */
  onTxClick?: (txid: string) => void;
  highlightFindingId: string | null;
  /** Reveal gate: finding-backed tags render only once their finding is revealed. */
  isRevealed: (findingId: string) => boolean;
  showTip: (el: HTMLElement, text: string) => void;
  hideTip: () => void;
}

export const StageContext = createContext<StageCtx>({
  findingTitle: () => null,
  highlightFindingId: null,
  isRevealed: () => true,
  showTip: () => {},
  hideTip: () => {},
});

export const useStage = () => useContext(StageContext);
