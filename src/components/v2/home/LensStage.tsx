"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MempoolTransaction } from "@/lib/api/types";
import { COLORS, V2_COLORS, HUES, hexToRgba } from "@/lib/palette";
import { formatBtc, fmtN } from "@/lib/format";
import type { LensModel, HubRow } from "./lens-model";
import { scriptLabel } from "./field-labels";

export interface Box { x: number; y: number; w: number; h: number }
export interface StageLayout { W: number; H: number; port: boolean; ins: Box[]; outs: Box[]; hub: { x: number; y: number }; box: Box; r: number }

export function layoutStage(nIn: number, nOut: number, rows: number, hubRows: number, port: boolean): StageLayout {
  const bh = 40 + hubRows * 22;
  if (!port) {
    const W = 1000, top = 52, rowH = 84, cw = 262, ch = 66;
    const col = (cnt: number) => Array.from({ length: cnt }, (_, i) => top + i * rowH + ((rows - cnt) * rowH) / 2);
    const by = top + rows * rowH + 12;
    return {
      W, H: by + bh + 24, port, r: 150,
      ins: col(nIn).map((y) => ({ x: 24, y, w: cw, h: ch })),
      outs: col(nOut).map((y) => ({ x: W - 24 - cw, y, w: cw, h: ch })),
      hub: { x: W / 2, y: top + (rows * rowH) / 2 - 9 }, box: { x: 300, y: by, w: 400, h: bh },
    };
  }
  const W = 400, top = 48, rowH = 74, x = 44, cw = 340, ch = 64;
  const ins = Array.from({ length: nIn }, (_, i) => ({ x, y: top + i * rowH, w: cw, h: ch }));
  const by = top + nIn * rowH + 8;
  const oy = by + bh + 26;
  const outs = Array.from({ length: nOut }, (_, i) => ({ x, y: oy + i * rowH, w: cw, h: ch }));
  return { W, H: oy + nOut * rowH + 14, port, r: 112, ins, outs, hub: { x: 22, y: by + bh / 2 }, box: { x, y: by, w: cw, h: bh } };
}

const SEV: Record<string, string> = {
  critical: COLORS.severityCritical, high: COLORS.severityHigh, medium: COLORS.severityMedium, low: COLORS.severityLow, good: COLORS.severityGood,
};
/** GREY: the blinded (CoinJoin) state. CLU: the sender-to-change ownership link, kept distinct from the orange accent and severities. */
const GREY = HUES.gray400, CLU = HUES.fuchsia400, PAD = 12;
const FG = (a: number) => hexToRgba(V2_COLORS.foreground, a);
const GLYPHS = "?#%&§░▒";
const short = (a: string | null) => (a ? `${a.slice(0, 8)}...${a.slice(-6)}` : "OP_RETURN");

interface Props {
  tx: MempoolTransaction;
  model: LensModel;
  L: StageLayout;
  lens: { x: number; y: number };
  revealAll: boolean;
  reduced: boolean;
  selected: string | null;
  onPick: (anchor: string) => void;
}

/** Two layers of the same transaction: the calm wallet view, and the analyst view clipped to the lens. */
export function LensStage({ tx, model, L, lens, revealAll, reduced, selected, onPick }: Props) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!model.blind || reduced) return;
    const id = setInterval(() => setTick((n) => n + 1), 120);
    return () => clearInterval(id);
  }, [model.blind, reduced]);
  const scramble = (i: number) => (reduced ? "????" : Array.from({ length: 4 }, (_, k) => GLYPHS[(tick * 7 + i * 13 + k * 5) % GLYPHS.length]).join(""));

  const accent = model.blind ? GREY : COLORS.bitcoin;
  const mid = (b: Box) => b.y + b.h / 2;
  const flowIn = (b: Box) => L.port
    ? `M${b.x} ${mid(b)}H38Q22 ${mid(b)} 22 ${mid(b) + 16}V${L.hub.y}`
    : `M${b.x + b.w} ${mid(b)}C${b.x + b.w + 110} ${mid(b)} ${L.hub.x - 120} ${L.hub.y} ${L.hub.x} ${L.hub.y}`;
  const flowOut = (b: Box) => L.port
    ? `M22 ${L.hub.y}V${mid(b) - 16}Q22 ${mid(b)} 38 ${mid(b)}H${b.x}`
    : `M${L.hub.x} ${L.hub.y}C${L.hub.x + 120} ${L.hub.y} ${b.x - 110} ${mid(b)} ${b.x} ${mid(b)}`;

  type Card = { key: string; box: Box; tag: string; main: string; sub: string; color: string; scr: boolean; bar?: number };
  const amt = (v: number) => formatBtc(v);
  const ins: Card[] = tx.vin.map((vin, i) => {
    const v = vin.prevout?.value ?? 0, st = scriptLabel(vin.prevout?.scriptpubkey_type ?? "unknown");
    const base = { key: `i${i}`, box: L.ins[i]!, scr: false };
    if (model.sendersKnown) return { ...base, tag: t("v2.home.lens_sender", { defaultValue: "SENDER" }), main: t("v2.home.lens_sender_main_likely", { defaultValue: "Likely same owner as the change" }), sub: `${amt(v)} · ${st}`, color: CLU };
    if (model.blind) return { ...base, tag: t("v2.home.lens_input", { defaultValue: "INPUT" }), main: t("v2.home.lens_input_blind", { defaultValue: "Could fund any of {{n}} outputs", n: tx.vout.length }), sub: `${amt(v)} · ${st}`, color: GREY };
    return { ...base, tag: t("v2.home.lens_input", { defaultValue: "INPUT" }), main: amt(v), sub: st, color: GREY };
  });
  const outs: Card[] = tx.vout.map((vo, i) => {
    const r = model.outputs[i] ?? null, base = { key: `o${i}`, box: L.outs[i]!, scr: false };
    if (r?.kind === "change") return { ...base, tag: t("v2.home.lens_change_likely", { defaultValue: "LIKELY CHANGE" }), main: t("v2.home.lens_change_main", { defaultValue: "Back to the sender" }), sub: r.agreement !== null ? t("v2.home.lens_change_agree", { defaultValue: "{{pct}}% of signals agree", pct: r.agreement }) : r.confidence ? t("v2.home.lens_confidence", { defaultValue: "engine confidence: {{c}}", c: r.confidence }) : amt(vo.value), color: CLU, bar: r.agreement ?? undefined };
    if (r?.kind === "self-send") return { ...base, tag: t("v2.home.lens_change_certain", { defaultValue: "CHANGE · CERTAIN" }), main: t("v2.home.lens_change_main", { defaultValue: "Back to the sender" }), sub: t("v2.home.lens_self_sub", { defaultValue: "address reused from an input" }), color: CLU, bar: 100 };
    if (r?.kind === "payment") return { ...base, tag: t("v2.home.lens_payment_likely", { defaultValue: "LIKELY PAYMENT" }), main: t("v2.home.lens_paid_likely", { defaultValue: "Likely paid {{amount}}", amount: amt(vo.value) }), sub: r.entityName ?? t("v2.home.lens_payment_sub", { defaultValue: "the output that is not change" }), color: COLORS.severityHigh };
    if (r?.kind === "blinded") return { ...base, tag: `OWNER ${scramble(i)}`, main: t("v2.home.lens_blind_main", { defaultValue: "1 of {{n}} identical outputs", n: r.anonSet }), sub: t("v2.home.lens_blind_sub", { defaultValue: "any input could own it" }), color: GREY, scr: true };
    return { ...base, tag: t("v2.home.lens_output", { defaultValue: "OUTPUT" }), main: amt(vo.value), sub: scriptLabel(vo.scriptpubkey_type), color: GREY };
  });

  const hubText = (r: HubRow): [string, string] => {
    switch (r.kind) {
      case "pool": return [t("v2.home.hub_pool", { defaultValue: "POOL" }), t("v2.home.hub_pool_v", { defaultValue: "Whirlpool {{denom}}", denom: r.denom })];
      case "wallet": return [t("v2.home.hub_wallet", { defaultValue: "WALLET" }), r.guess ? t("v2.home.hub_wallet_guess", { defaultValue: "likely {{name}}", name: r.guess }) : r.more ? `${r.signal} +${r.more}` : r.signal];
      case "version": return [t("v2.home.hub_version", { defaultValue: "VERSION" }), t("v2.home.hub_version_v", { defaultValue: "nVersion {{v}}, legacy", v: r.version })];
      case "locktime": return [t("v2.home.hub_locktime", { defaultValue: "LOCKTIME" }), t("v2.home.hub_locktime_v", { defaultValue: "nLockTime 0, no anti-fee-sniping" })];
      case "entropy": return [t("v2.home.hub_entropy", { defaultValue: "ENTROPY" }), r.interpretations !== null
        ? t("v2.home.hub_entropy_n", { defaultValue: "{{bits}} bits · {{n}} interpretations", bits: r.bits, n: fmtN(r.interpretations) })
        : r.bits === 0 ? t("v2.home.hub_entropy_zero", { defaultValue: "0 bits · 1 interpretation" }) : t("v2.home.hub_entropy_bits", { defaultValue: "{{bits}} bits", bits: r.bits })];
    }
  };

  const b = L.box;
  const touched = [...ins, ...outs].map((c) => c.box).concat(b).filter((c) => {
    const dx = lens.x - Math.max(c.x - PAD, Math.min(lens.x, c.x + c.w + PAD));
    const dy = lens.y - Math.max(c.y - PAD, Math.min(lens.y, c.y + c.h + PAD));
    return dx * dx + dy * dy < L.r * L.r;
  });
  const sel = (k: string) => selected === k;

  return (
    <svg viewBox={`0 0 ${L.W} ${L.H}`} className="block w-full h-auto select-none" aria-hidden="true">
      <defs>
        <pattern id="lens-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke={model.blind ? hexToRgba(GREY, 0.07) : hexToRgba(COLORS.bitcoin, 0.08)} /></pattern>
        <pattern id="lens-scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill={hexToRgba(V2_COLORS.background, 0.25)} /></pattern>
        <clipPath id="lens-clip">
          {revealAll ? <rect width={L.W} height={L.H} /> : (
            <>
              <circle cx={lens.x} cy={lens.y} r={L.r} />
              {/* A card the lens touches is revealed whole (12px padding), so no label is ever cut by the rim. */}
              {touched.map((c, i) => <rect key={i} x={c.x - PAD} y={c.y - PAD} width={c.w + PAD * 2} height={c.h + PAD * 2} rx={12} />)}
            </>
          )}
        </clipPath>
      </defs>

      {/* Wallet view: calm */}
      <rect width={L.W} height={L.H} fill={V2_COLORS.surface1} />
      {ins.map((c) => <path key={c.key} d={flowIn(c.box)} fill="none" stroke={FG(0.12)} strokeWidth={3} />)}
      {outs.map((c) => <path key={c.key} d={flowOut(c.box)} fill="none" stroke={FG(0.12)} strokeWidth={3} />)}
      <circle cx={L.hub.x} cy={L.hub.y} r={L.port ? 12 : 22} fill={V2_COLORS.surface2} stroke={FG(0.16)} />
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill={V2_COLORS.surface1} stroke={FG(0.1)} strokeDasharray="3 4" />
      <text x={b.x + 14} y={b.y + 23} className="font-mono" fontSize={10.5} letterSpacing="0.08em" fill={V2_COLORS.faint}>{t("v2.home.lens_tx", { defaultValue: "TRANSACTION" })}</text>
      {[[t("v2.home.lens_fee", { defaultValue: "fee" }), `${fmtN(tx.fee)} sats`], [t("v2.home.lens_size", { defaultValue: "size" }), `${fmtN(tx.weight)} WU`], [t("v2.home.lens_block", { defaultValue: "block" }), tx.status.block_height ? fmtN(tx.status.block_height) : "-"]].map(([k, v], i) => (
        <g key={k} className="font-mono" fontSize={12.5} fill={V2_COLORS.muted}>
          <text x={b.x + 14} y={b.y + 45 + i * 22}>{k}</text>
          <text x={b.x + b.w - 14} y={b.y + 45 + i * 22} textAnchor="end" fill={V2_COLORS.foreground}>{v}</text>
        </g>
      ))}
      {[...ins, ...outs].map((c) => (
        <g key={c.key}>
          <rect x={c.box.x} y={c.box.y} width={c.box.w} height={c.box.h} rx={10} fill={V2_COLORS.surface2} stroke={FG(0.1)} />
          <text x={c.box.x + 14} y={c.box.y + 24} className="font-mono" fontSize={12.5} fill={V2_COLORS.muted}>{short(c.key[0] === "i" ? tx.vin[+c.key.slice(1)]?.prevout?.scriptpubkey_address ?? null : tx.vout[+c.key.slice(1)]?.scriptpubkey_address ?? null)}</text>
          <text x={c.box.x + c.box.w - 14} y={c.box.y + 24} textAnchor="end" className="font-mono" fontSize={10.5} fill={V2_COLORS.faint}>{c.key[0] === "i" ? "IN" : "OUT"} {c.key.slice(1)}</text>
          <text x={c.box.x + 14} y={c.box.y + 49} fontSize={16} fontWeight={500} fill={V2_COLORS.foreground}>{formatBtc(c.key[0] === "i" ? tx.vin[+c.key.slice(1)]?.prevout?.value ?? 0 : tx.vout[+c.key.slice(1)]!.value)}</text>
        </g>
      ))}
      <text x={L.port ? 16 : 24} y={28} className="font-mono" fontSize={11} fontWeight={600} letterSpacing="0.12em" fill={V2_COLORS.faint}>{t("v2.home.lens_wallet_view", { defaultValue: "WALLET VIEW" })}</text>

      {/* Analyst view, clipped to the lens */}
      <g clipPath="url(#lens-clip)">
        <rect width={L.W} height={L.H} fill={V2_COLORS.background} />
        <rect width={L.W} height={L.H} fill={hexToRgba(model.blind ? COLORS.severityGood : COLORS.bitcoin, 0.035)} />
        <rect width={L.W} height={L.H} fill="url(#lens-grid)" />
        {model.blind && !L.port ? (
          <>
            {ins.map((a) => outs.map((o) => (
              <path key={a.key + o.key} d={`M${a.box.x + a.box.w} ${mid(a.box)}C${a.box.x + a.box.w + 180} ${mid(a.box)} ${o.box.x - 180} ${mid(o.box)} ${o.box.x} ${mid(o.box)}`} fill="none" stroke={GREY} strokeOpacity={0.28} strokeWidth={1.5} strokeDasharray="2 5" />
            )))}
            <text x={L.W / 2} y={L.hub.y - 36} textAnchor="middle" className="font-mono" fontSize={11.5} fontWeight={600} letterSpacing="0.06em" fill={V2_COLORS.foreground}>
              {t("v2.home.lens_links", { defaultValue: "{{n}} POSSIBLE LINKS", n: ins.length * outs.length })}
            </text>
          </>
        ) : (
          <>
            {ins.map((c) => <path key={c.key} d={flowIn(c.box)} fill="none" stroke={model.blind ? hexToRgba(GREY, 0.6) : c.color} strokeWidth={model.blind ? 2 : 4} strokeDasharray={model.blind ? "2 5" : undefined} />)}
            {outs.map((c) => <path key={c.key} d={flowOut(c.box)} fill="none" stroke={model.blind ? hexToRgba(GREY, 0.6) : c.color} strokeWidth={model.blind ? 2 : 4} strokeDasharray={model.blind ? "2 5" : c.color === CLU ? "8 6" : undefined} />)}
          </>
        )}
        <circle cx={L.hub.x} cy={L.hub.y} r={L.port ? 12 : 22} fill={V2_COLORS.background} stroke={accent} strokeWidth={2} />
        <text x={L.hub.x} y={L.hub.y + 4} textAnchor="middle" className="font-mono" fontSize={L.port ? 9 : 11} fontWeight={600} fill={accent}>{model.blind ? "?" : "TX"}</text>
        {model.ciohVoid && (
          <g onClick={() => onPick("cioh")} className="cursor-pointer">
            <path d={L.port ? `M${L.W - 14} ${L.ins[0]!.y + 6}H${L.W - 8}V${L.ins.at(-1)!.y + L.ins[0]!.h - 6}H${L.W - 14}` : `M18 ${L.ins[0]!.y + 6}H12V${L.ins.at(-1)!.y + L.ins[0]!.h - 6}H18`} fill="none" stroke={GREY} strokeWidth={2} strokeDasharray="3 4" />
            <text x={L.port ? L.W - 8 : 24} y={L.ins[0]!.y - 10} textAnchor={L.port ? "end" : "start"} className="font-mono" fontSize={11} fontWeight={600} letterSpacing="0.06em" fill={GREY}>{t("v2.home.lens_cioh_void", { defaultValue: "CIOH CLUSTER VOID · COINJOIN" })}</text>
          </g>
        )}
        {[...ins, ...outs].map((c) => (
          <g key={c.key} onClick={() => onPick(c.key)} className="cursor-pointer">
            <rect x={c.box.x} y={c.box.y} width={c.box.w} height={c.box.h} rx={10} fill={V2_COLORS.background} />
            <rect x={c.box.x} y={c.box.y} width={c.box.w} height={c.box.h} rx={10} fill={c.color} fillOpacity={0.1} stroke={c.color} strokeWidth={sel(c.key) ? 2.5 : 1.5} />
            <text x={c.box.x + 14} y={c.box.y + 20} className="font-mono" fontSize={11} fontWeight={600} letterSpacing="0.06em" fill={c.color}>{c.tag}</text>
            <text x={c.box.x + 14} y={c.box.y + 41} fontSize={15} fontWeight={600} fill={V2_COLORS.foreground}>{c.main}</text>
            <text x={c.box.x + 14} y={c.box.y + 57} className="font-mono" fontSize={11.5} fill={V2_COLORS.muted}>{c.sub}</text>
            {c.bar !== undefined && <rect x={c.box.x + 1} y={c.box.y + c.box.h - 4} width={((c.box.w - 2) * c.bar) / 100} height={3} rx={1.5} fill={c.color} />}
          </g>
        ))}
        <g onClick={() => onPick("hub")} className="cursor-pointer">
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill={V2_COLORS.background} />
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={10} fill={model.blind ? COLORS.severityGood : COLORS.bitcoin} fillOpacity={0.07} stroke={hexToRgba(model.blind ? COLORS.severityGood : COLORS.bitcoin, 0.35)} strokeWidth={sel("hub") ? 2.5 : 1} />
          <text x={b.x + 14} y={b.y + 23} className="font-mono" fontSize={11} fontWeight={600} letterSpacing="0.12em" fill={model.blind ? COLORS.severityGood : COLORS.bitcoin}>
            {model.blind ? t("v2.home.lens_hub_blind", { defaultValue: "WHAT THE ANALYST GETS" }) : t("v2.home.lens_hub", { defaultValue: "FINGERPRINT & ENTROPY" })}
          </text>
          {model.hub.map((r, i) => {
            const [k, v] = hubText(r);
            return (
              <g key={r.kind} className="font-mono">
                <text x={b.x + 14} y={b.y + 45 + i * 22} fontSize={11} fontWeight={600} letterSpacing="0.06em" fill={SEV[r.severity]}>{k}</text>
                <text x={b.x + (L.port ? 92 : 104)} y={b.y + 45 + i * 22} fontSize={L.port ? 11 : 12} fill={V2_COLORS.foreground}>{v}</text>
              </g>
            );
          })}
        </g>
        <rect width={L.W} height={L.H} fill="url(#lens-scan)" pointerEvents="none" />
      </g>

      {revealAll && (
        <text x={L.W - (L.port ? 16 : 24)} y={28} textAnchor="end" className="font-mono" fontSize={11} fontWeight={600} letterSpacing="0.12em" fill={accent}>
          {model.blind ? t("v2.home.lens_view_blind", { defaultValue: "ANALYST VIEW · NO SIGNAL" }) : t("v2.home.lens_view", { defaultValue: "ANALYST VIEW" })}
        </text>
      )}
      {!revealAll && (
        <g pointerEvents="none" stroke={accent}>
          <circle cx={lens.x} cy={lens.y} r={L.r} fill="none" strokeWidth={2} strokeDasharray={model.blind ? "4 6" : undefined} />
          <circle cx={lens.x} cy={lens.y} r={L.r + 7} fill="none" strokeOpacity={0.25} />
          <path d={`M${lens.x - 8} ${lens.y}h16M${lens.x} ${lens.y - 8}v16`} strokeWidth={1.5} />
          <text x={Math.max(70, Math.min(L.W - 70, lens.x))} y={lens.y - L.r - 14 < 18 ? Math.min(L.H - 8, lens.y + L.r + 24) : lens.y - L.r - 14} textAnchor="middle" stroke="none" fill={accent} className="font-mono" fontSize={11} fontWeight={600} letterSpacing="0.12em">
            {model.blind ? t("v2.home.lens_blinded", { defaultValue: "LENS BLINDED" }) : t("v2.home.lens_name", { defaultValue: "ANALYST LENS" })}
          </text>
        </g>
      )}
    </svg>
  );
}
