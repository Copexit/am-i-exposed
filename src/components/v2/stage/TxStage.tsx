"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Eye, Link2, Maximize2, X } from "lucide-react";
import { useFullscreen } from "@/hooks/useFullscreen";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { findingKeys } from "@/lib/finding-utils";
import { formatSats, calcFeeRate, calcVsize } from "@/lib/format";
import { buildBoltzmannLookup, type BoltzmannLookup } from "@/components/viz/buildFlowGraph";
import type { MempoolTransaction, MempoolOutspend } from "@/lib/api/types";
import type { BoltzmannWorkerResult } from "@/lib/analysis/boltzmann-pool";
import type { ResultViewModel } from "@/lib/view/tx-view-model";
import { buildStageRows, type StageSide } from "./stage-layout";
import { buildAnalystReadings, type TxReadings } from "./analyst";
import { StageContext, type StageCtx } from "./StageContext";
import { StageDiagram } from "./StageDiagram";
import { AnalystSummary, LinkLegend } from "./StageNotes";

export interface TxStageProps {
  tx: MempoolTransaction;
  vm: ResultViewModel;
  outspends?: MempoolOutspend[] | null;
  usdPrice?: number | null;
  boltzmannResult?: BoltzmannWorkerResult | null;
  onAddressClick?: (address: string) => void;
  onFindingClick?: (findingId: string) => void;
  /** Rescan a related transaction (the child that co-spent outputs, a shared parent). */
  onTxClick?: (txid: string) => void;
  highlightFindingId?: string | null;
  reveal?: { isRevealed: (findingId: string) => boolean; playing: boolean };
}

/** Rows per side before the rest collapses into a "more" row. */
const LIMIT = 12;
/** Below this width the stage stacks inputs above outputs. */
const STACK_BELOW = 640;

/**
 * The v2 transaction stage: value flow from inputs to outputs, with every tag
 * taken from the view model (vm.io) and linked to the finding behind it.
 * Spend status comes from vm.io, or from `outspends` when the view model was
 * built before they arrived.
 */
export function TxStage({ tx, vm, outspends, usdPrice, boltzmannResult, onAddressClick, onFindingClick, onTxClick, highlightFindingId = null, reveal }: TxStageProps) {
  const { t } = useTranslation();
  const [linkMode, setLinkMode] = useState(false);
  const [analyst, setAnalyst] = useState(false);
  const [open, setOpen] = useState<Record<StageSide, boolean>>({ input: false, output: false });
  const { isExpanded: full, expand, collapse } = useFullscreen();
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const lookup = useMemo(() => buildBoltzmannLookup(boltzmannResult, true, tx), [boltzmannResult, tx]);
  const readings = useMemo(() => (analyst ? buildAnalystReadings(vm) : null), [analyst, vm]);
  const byId = useMemo(() => new Map(vm.all.map((f) => [f.id as string, f])), [vm.all]);
  const isRevealed = reveal?.isRevealed;

  const ctx = useMemo<StageCtx>(() => ({
    findingTitle: (id) => {
      const f = byId.get(id);
      return f ? t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title }) : null;
    },
    onFindingClick,
    onTxClick,
    highlightFindingId,
    isRevealed: isRevealed ?? (() => true),
    showTip: (el, text) => {
      const r = el.getBoundingClientRect();
      setTip({ text, x: r.left + r.width / 2, y: r.top });
    },
    hideTip: () => setTip(null),
  }), [byId, t, onFindingClick, onTxClick, highlightFindingId, isRevealed]);

  const title = t("v2.stage.title", { defaultValue: "Transaction flow" });
  const toggles = (
    <div className="flex flex-wrap items-center gap-1.5">
      {lookup && (
        <Toggle pressed={linkMode} onClick={() => setLinkMode((v) => !v)} icon={<Link2 size={13} aria-hidden="true" />}>
          {t("v2.stage.linkability", { defaultValue: "Linkability" })}
        </Toggle>
      )}
      <Toggle pressed={analyst} onClick={() => setAnalyst((v) => !v)} icon={<Eye size={13} aria-hidden="true" />}>
        {t("v2.stage.analystView", { defaultValue: "Analyst view" })}
      </Toggle>
    </div>
  );

  if (!vm.io) return null;
  const body = (forceAll: boolean) => (
    <StageBody
      tx={tx} vm={vm} outspends={outspends} usdPrice={usdPrice} lookup={lookup} linkMode={linkMode} readings={readings}
      open={forceAll ? { input: true, output: true } : open} setOpen={setOpen} scroll={!forceAll}
      onAddressClick={onAddressClick}
    />
  );

  return (
    <StageContext.Provider value={ctx}>
      <section data-testid="tx-stage" aria-label={title} className="w-full rounded-xl border border-hairline bg-surface-1 shadow-(--shadow-card)">
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 pb-2 sm:px-5">
          <h3 className="v2-eyebrow">{title}</h3>
          <div className="flex items-center gap-1.5">
            {toggles}
            <button
              type="button"
              onClick={expand}
              aria-label={t("v2.stage.fullscreen", { defaultValue: "Open fullscreen" })}
              title={t("v2.stage.fullscreen", { defaultValue: "Open fullscreen" })}
              className="inline-flex items-center justify-center size-11 sm:size-8 rounded-lg text-muted hover:text-foreground hover:bg-surface-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin"
            >
              <Maximize2 size={14} aria-hidden="true" />
            </button>
          </div>
        </header>
        {!full && body(false)}
      </section>

      {full && (
        <FullscreenStage title={title} toggles={toggles} onClose={collapse}>
          {body(true)}
        </FullscreenStage>
      )}

      {tip && (
        <div
          role="presentation"
          className="fixed z-[70] pointer-events-none max-w-[280px] -translate-x-1/2 -translate-y-full rounded-lg border border-hairline-strong bg-surface-float shadow-(--shadow-card) px-2.5 py-1.5 text-[12px] leading-snug text-foreground shadow-lg"
          style={{ left: Math.min(Math.max(tip.x, 150), (typeof window !== "undefined" ? window.innerWidth : 1000) - 150), top: tip.y - 6 }}
        >
          {tip.text}
        </div>
      )}
    </StageContext.Provider>
  );
}

function Toggle({ pressed, onClick, icon, children }: { pressed: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 h-11 sm:h-8 px-3 rounded-lg border text-[12px] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin ${
        pressed ? "border-bitcoin/50 bg-bitcoin/10 text-bitcoin" : "border-hairline-strong text-muted hover:text-foreground hover:border-foreground/25"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

interface StageBodyProps {
  tx: MempoolTransaction;
  vm: ResultViewModel;
  outspends?: MempoolOutspend[] | null;
  usdPrice?: number | null;
  lookup: BoltzmannLookup | null;
  linkMode: boolean;
  readings: TxReadings | null;
  open: Record<StageSide, boolean>;
  setOpen: React.Dispatch<React.SetStateAction<Record<StageSide, boolean>>>;
  /** Cap the height and scroll inside (inline stage); the fullscreen view scrolls itself. */
  scroll: boolean;
  onAddressClick?: (address: string) => void;
}

function StageBody({ tx, vm, outspends, usdPrice, lookup, linkMode, readings, open, setOpen, scroll, onAddressClick }: StageBodyProps) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const io = vm.io!;
  const outputs = useMemo(
    () => (outspends ? io.outputs.map((o) => (o.spent === null && outspends[o.index] ? { ...o, spent: outspends[o.index]!.spent } : o)) : io.outputs),
    [io.outputs, outspends],
  );
  // Tiers group a CoinJoin's equal outputs; linkability needs individual outputs.
  const grouped = vm.isCoinJoin && !open.output && !linkMode;
  const inRows = useMemo(() => buildStageRows(io.inputs, "input", { groupTiers: false, limit: open.input ? null : LIMIT }), [io.inputs, open.input]);
  const outRows = useMemo(() => buildStageRows(outputs, "output", { groupTiers: grouped, limit: open.output ? null : LIMIT }), [outputs, grouped, open.output]);
  const onShowMore = useCallback((side: StageSide) => setOpen((o) => ({ ...o, [side]: true })), [setOpen]);
  const tall = scroll && Math.max(inRows.length, outRows.length) > 14;
  const lang = i18n.language;

  return (
    <div ref={ref} className="px-1 pb-3 sm:px-2">
      {readings && <AnalystSummary readings={readings} hasLookup={!!lookup} />}
      {linkMode && lookup && <LinkLegend timedOut={lookup.timedOut} />}
      {width > 0 && (
        <div className={tall ? "max-h-[72vh] overflow-y-auto overscroll-contain" : ""}>
          <StageDiagram
            tx={tx} inRows={inRows} outRows={outRows} stacked={width < STACK_BELOW} usdPrice={usdPrice}
            lookup={lookup} linkMode={linkMode} readings={readings} onAddressClick={onAddressClick} onShowMore={onShowMore}
          />
        </div>
      )}
      <footer className="mt-3 mx-3 pt-3 border-t border-hairline flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-muted">
        <span className="v2-num">{t("v2.stage.fee", { amount: formatSats(tx.fee, lang), defaultValue: "fee {{amount}}" })}</span>
        <span className="v2-num">{t("v2.stage.feeRate", { rate: calcFeeRate(tx), defaultValue: "{{rate}} sat/vB" })}</span>
        <span className="v2-num">{t("v2.stage.vsize", { vsize: calcVsize(tx.weight).toLocaleString(lang), defaultValue: "{{vsize}} vB" })}</span>
        <span className="v2-num">{t("v2.stage.weight", { weight: tx.weight.toLocaleString(lang), defaultValue: "{{weight}} WU" })}</span>
        <span className="flex-1" />
        {grouped && outRows.some((r) => r.kind === "tier") && (
          <FooterButton onClick={() => onShowMore("output")}>{t("v2.stage.showIndividual", { defaultValue: "Show individual outputs" })}</FooterButton>
        )}
        {scroll && (open.input || open.output) && (
          <FooterButton onClick={() => setOpen({ input: false, output: false })}>{t("v2.stage.collapse", { defaultValue: "Collapse" })}</FooterButton>
        )}
      </footer>
    </div>
  );
}

function FooterButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 sm:min-h-0 px-1 text-bitcoin/85 hover:text-bitcoin cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-bitcoin">
      {children}
    </button>
  );
}

function FullscreenStage({ title, toggles, onClose, children }: { title: string; toggles: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useFocusTrap(ref, true);
  useEffect(() => { closeRef.current?.focus(); }, []);
  return createPortal(
    <div data-ui="v2" className="contents">
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-[60] flex flex-col bg-background">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-hairline sm:px-6">
          <h2 className="v2-eyebrow">{title}</h2>
          <div className="flex items-center gap-1.5">
            {toggles}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label={t("common.close", { defaultValue: "Close" })}
              className="inline-flex items-center justify-center size-11 sm:size-9 rounded-lg text-muted hover:text-foreground hover:bg-surface-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1360px] py-4 sm:px-4">{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
