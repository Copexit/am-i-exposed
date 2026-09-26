"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import type { MempoolTransaction } from "@/lib/api/types";
import type { Finding } from "@/lib/types";
import { analyzeTransactionSync } from "@/lib/analysis/analyze-sync";
import { loadEntityFilter } from "@/lib/analysis/entity-filter";
import { buildResultViewModel } from "@/lib/view/tx-view-model";
import { TX_BASE_SCORE } from "@/lib/scoring/score";
import { GRADE_VAR } from "@/lib/constants";
import { formatBtc, fmtN } from "@/lib/format";
import { findingKeys } from "@/lib/finding-utils";
import { SEVERITY_BG } from "@/components/v2/results/severity";
// Real mainnet transactions (the engine's test fixtures), bundled so the explainer makes no network request.
import legacyTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/simple-legacy-p2pkh.json";
import whirlpoolTx from "@/lib/analysis/heuristics/__tests__/fixtures/api-responses/whirlpool-coinjoin.json";
import { deriveLens } from "./lens-model";
import { LensStage, layoutStage } from "./LensStage";

const TXS = { legacy: legacyTx as unknown as MempoolTransaction, whirlpool: whirlpoolTx as unknown as MempoolTransaction };
type Key = keyof typeof TXS;

function analyze(tx: MempoolTransaction) {
  const vm = buildResultViewModel({ result: analyzeTransactionSync(tx), baseScore: TX_BASE_SCORE, tx });
  return { vm, model: deriveLens(vm, tx) };
}

/**
 * "What your wallet shows you. What an analyst sees." Findings computed live by
 * the engine on bundled txs. Waits for the local entity index (already being
 * loaded by the scanner, same-origin, cached) so the result is deterministic.
 */
export function LensExplainer() {
  const [ready, setReady] = useState(false);
  useEffect(() => { void loadEntityFilter().finally(() => setReady(true)); }, []);
  return ready ? <LensExplainerBody /> : <div className="min-h-[720px]" />;
}

function LensExplainerBody() {
  const { t } = useTranslation();
  const reduced = !!useReducedMotion();
  const data = useMemo(() => ({ legacy: analyze(TXS.legacy), whirlpool: analyze(TXS.whirlpool) }), []);
  const [key, setKey] = useState<Key>("legacy");
  // Touch screens start with the whole analyst layer shown; the lens is one tap away.
  const [revealAll, setRevealAll] = useState(() => window.matchMedia("(pointer: coarse)").matches);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [port, setPort] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgBox = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const tx = TXS[key];
  const { vm, model } = data[key];
  const L = useMemo(() => layoutStage(tx.vin.length, tx.vout.length, Math.max(tx.vin.length, tx.vout.length), Math.max(3, model.hub.length), port), [tx, model, port]);
  const [lens, setLens] = useState({ x: -200, y: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPort(el.clientWidth < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const anchorOf = useCallback((k: string) => {
    if (k === "hub") return { x: L.box.x + L.box.w / 2, y: L.box.y + L.box.h / 2 };
    if (k === "cioh") return { x: L.ins[0]!.x + L.ins[0]!.w / 2, y: L.ins[0]!.y + L.ins[0]!.h / 2 };
    const b = k[0] === "i" ? L.ins[+k.slice(1)] : L.outs[+k.slice(1)];
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : { x: L.W / 2, y: L.H / 2 };
  }, [L]);

  const lensRef = useRef(lens);
  const put = useCallback((p: { x: number; y: number }) => { lensRef.current = p; setLens(p); }, []);
  const glide = useCallback((to: { x: number; y: number }, from?: { x: number; y: number }) => {
    cancelAnimationFrame(raf.current);
    if (reduced) { raf.current = requestAnimationFrame(() => put(to)); return; }
    const s = from ?? lensRef.current, t0 = performance.now(), dur = from ? 1400 : 420;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      put({ x: s.x + (to.x - s.x) * e, y: s.y + (to.y - s.y) * e });
      if (k < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [reduced, put]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Intro: sweep the lens in from the left onto the most telling card.
  const hero = model.outputs.findIndex((r) => r?.kind === "change" || r?.kind === "self-send");
  const heroKey = hero >= 0 ? `o${hero}` : `o${Math.floor(tx.vout.length / 2)}`;
  useEffect(() => {
    const to = anchorOf(heroKey);
    glide(to, { x: -L.r, y: to.y });
  }, [key, port, heroKey, anchorOf, glide, L.r]);

  const toSvg = (e: PointerEvent) => {
    const r = svgBox.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: ((e.clientX - r.left) / r.width) * L.W, y: ((e.clientY - r.top) / r.height) * L.H };
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || revealAll) return;
    const p = toSvg(e);
    if (p) { cancelAnimationFrame(raf.current); put(p); }
  };
  const onDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" || revealAll) return;
    const p = toSvg(e);
    if (p) glide(p);
  };
  const onKey = (e: KeyboardEvent) => {
    const d = ({ ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] } as Record<string, [number, number]>)[e.key];
    if (!d) return;
    e.preventDefault();
    cancelAnimationFrame(raf.current);
    const c = lensRef.current;
    put({ x: Math.max(0, Math.min(L.W, c.x + d[0])), y: Math.max(0, Math.min(L.H, c.y + d[1])) });
  };

  // Map finding -> stage anchor (so the notebook can point the lens) and anchor -> finding.
  const anchorForFinding = (f: Finding): string | null => {
    const out = model.outputs.findIndex((r) => r?.findingId === f.id);
    if (out >= 0) return `o${out}`;
    if (model.hub.some((r) => r.findingId === f.id)) return "hub";
    if (f.id === model.ciohVoid) return "cioh";
    return null;
  };
  const pick = (anchor: string) => {
    setSelected(anchor);
    const f = vm.visible.find((x) => anchorForFinding(x) === anchor);
    if (f) setOpen(f.id);
  };
  const choose = (f: Finding) => {
    const next = open === f.id ? null : f.id;
    setOpen(next);
    const a = next ? anchorForFinding(f) : null;
    setSelected(a);
    if (a && !revealAll) glide(anchorOf(a));
  };

  const leaks = vm.visible.filter((f) => f.severity !== "good");
  const blinds = vm.visible.filter((f) => f.severity === "good");
  const v = model.verdict;
  const verdict = v.kind === "blind"
    ? v.interpretations !== null
      ? t("v2.home.verdict_blind_n", { defaultValue: "Cannot tell who paid whom. {{n}} identical outputs, {{i}} valid interpretations.", n: v.anonSet, i: fmtN(v.interpretations) })
      : t("v2.home.verdict_blind", { defaultValue: "Cannot tell who paid whom. {{n}} identical outputs.", n: v.anonSet })
    : v.kind === "change"
      ? v.certain
        ? t("v2.home.verdict_change_certain", { defaultValue: "Paid {{paid}}. The change ({{change}}) went back to the sender, with certainty.", paid: formatBtc(v.paid), change: formatBtc(v.change) })
        : v.agreement !== null
          ? t("v2.home.verdict_change_likely_pct", { defaultValue: "Likely paid {{paid}}. The change ({{change}}) likely went back to the sender ({{pct}}% of signals agree).", paid: formatBtc(v.paid), change: formatBtc(v.change), pct: v.agreement })
          : t("v2.home.verdict_change_likely", { defaultValue: "Likely paid {{paid}}. The change ({{change}}) likely went back to the sender.", paid: formatBtc(v.paid), change: formatBtc(v.change) })
      : t("v2.home.verdict_none", { defaultValue: "No payment/change split could be read." });

  const TABS: { k: Key; label: string }[] = [
    { k: "legacy", label: t("v2.home.lens_tab_legacy", { defaultValue: "Simple payment" }) },
    { k: "whirlpool", label: t("v2.home.lens_tab_whirlpool", { defaultValue: "Whirlpool CoinJoin" }) },
  ];
  const seg = "min-h-[44px] px-3 rounded-lg text-sm inline-flex items-center gap-2 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-bitcoin";

  const note = (f: Finding) => {
    const expanded = open === f.id;
    const desc = t(findingKeys(f.id, "description", f.params), { ...f.params, defaultValue: f.description });
    return (
      <li key={f.id} className="relative">
        <span className={`absolute left-0 top-3 bottom-3 w-[2px] rounded-full ${SEVERITY_BG[f.severity]}`} aria-hidden="true" />
        <button type="button" onClick={() => choose(f)} aria-expanded={expanded} className={`w-full text-left pl-4 pr-3 py-2.5 min-h-[44px] rounded-md hover:bg-surface-2 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-bitcoin ${expanded ? "bg-surface-2" : ""}`}>
          <span className="flex items-baseline gap-3">
            <span className="flex-1 text-[13.5px] leading-snug">{t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title })}</span>
            <span className="v2-num text-xs text-muted">{f.scoreImpact > 0 ? "+" : ""}{f.scoreImpact}</span>
          </span>
          {expanded && <span className="block mt-1.5 text-[13px] leading-relaxed text-muted">{desc}</span>}
        </button>
      </li>
    );
  };

  return (
    <section aria-labelledby="v2-lens" className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 pt-16 sm:pt-24" data-testid="v2-lens-explainer">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 mb-6">
        <div className="max-w-[48rem]">
          <p className="v2-eyebrow">{t("v2.home.lens_eyebrow", { defaultValue: "Analyst lens" })}</p>
          <h2 id="v2-lens" className="mt-3 text-[28px] sm:text-[40px] font-semibold tracking-tight leading-[1.08] text-balance">
            {t("v2.home.lens_h_1", { defaultValue: "What your wallet shows you." })}{" "}
            <span className={model.blind ? "text-severity-good" : "text-bitcoin"}>
              {model.blind ? t("v2.home.lens_h_blind", { defaultValue: "What an analyst cannot see." }) : t("v2.home.lens_h_2", { defaultValue: "What an analyst sees." })}
            </span>
          </h2>
          <p className="mt-3 text-[15px] leading-relaxed text-muted">
            {t("v2.home.lens_lede", { defaultValue: "Move the lens over a real transaction. Every label under it comes from a finding the am-i.exposed engine just computed in this browser." })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <div role="group" aria-label={t("v2.home.lens_pick", { defaultValue: "Example transaction" })} className="inline-flex p-1 gap-1 rounded-xl border border-hairline bg-surface-1">
            {TABS.map((tab) => (
              <button key={tab.k} type="button" aria-pressed={key === tab.k} onClick={() => { setKey(tab.k); setSelected(null); setOpen(null); }} className={`${seg} ${key === tab.k ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>
                {tab.label}
                <span className="v2-num text-xs font-semibold" style={{ color: GRADE_VAR[data[tab.k].vm.grade] }}>{data[tab.k].vm.grade}</span>
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={revealAll} onClick={() => setRevealAll((r) => !r)} className={`${seg} border border-hairline ${revealAll ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}>
            {t("v2.home.lens_reveal", { defaultValue: "Show everything" })}
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        <div className="rounded-xl border border-hairline bg-surface-1 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 border-b border-hairline">
            <span className="v2-num text-xs text-muted truncate min-w-0 flex-1">{tx.txid}</span>
            <span className="v2-num text-xs text-faint">{t("v2.home.lens_meta", { defaultValue: "{{i}} in · {{o}} out · block {{b}}", i: tx.vin.length, o: tx.vout.length, b: fmtN(tx.status.block_height ?? 0) })}</span>
          </div>
          <div
            ref={stageRef}
            tabIndex={0}
            onKeyDown={onKey}
            onPointerMove={onMove}
            onPointerDown={onDown}
            aria-label={t("v2.home.lens_stage", { defaultValue: "Transaction under the analyst lens. Arrow keys move the lens." })}
            className={`relative focus-visible:outline-2 focus-visible:outline-bitcoin focus-visible:-outline-offset-2 ${revealAll ? "" : "md:cursor-none"}`}
          >
            <div ref={svgBox}>
              <LensStage tx={tx} model={model} L={L} lens={lens} revealAll={revealAll} reduced={reduced} selected={selected} onPick={pick} />
            </div>
          </div>
          <div className="flex items-center gap-4 px-4 py-3.5 border-t border-hairline bg-surface-2">
            <div className="shrink-0">
              <div className="text-[36px] font-bold leading-none tracking-tight" style={{ color: GRADE_VAR[vm.grade] }}>{vm.grade}</div>
              <div className="v2-num text-[11px] text-muted mt-1">{vm.score}/100</div>
            </div>
            <div className="min-w-0">
              <p className="v2-eyebrow">{t("v2.home.lens_concludes", { defaultValue: "An analyst concludes" })}</p>
              <p className="mt-1 text-[15px] leading-snug">{verdict}</p>
            </div>
          </div>
        </div>

        <aside className="rounded-xl border border-hairline bg-surface-1 py-2" aria-label={t("v2.home.lens_notebook", { defaultValue: "Analyst notebook" })}>
          {leaks.length > 0 && (
            <>
              <h3 className="v2-eyebrow px-4 pt-3 pb-2">{model.blind ? t("v2.home.lens_residual", { defaultValue: "Residual leaks" }) : t("v2.home.lens_leaked", { defaultValue: "What leaked" })}</h3>
              <ul className="px-1">{leaks.map(note)}</ul>
            </>
          )}
          {blinds.length > 0 && (
            <>
              <h3 className="v2-eyebrow px-4 pt-4 pb-2">{t("v2.home.lens_blinds", { defaultValue: "What blinds the analyst" })}</h3>
              <ul className="px-1">{blinds.map(note)}</ul>
            </>
          )}
          <p className="px-4 pt-3 pb-2 text-xs leading-relaxed text-faint">
            {t("v2.home.lens_quick", { defaultValue: "Quick score from the transaction alone. A full scan also follows its parents and children, which can add findings (a peel chain, for example)." })}
          </p>
        </aside>
      </div>
    </section>
  );
}
