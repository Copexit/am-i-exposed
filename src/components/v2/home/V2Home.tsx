"use client";

import { Suspense, lazy, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { AddressInput } from "@/components/AddressInput";
import { ScanHistory } from "@/components/ScanHistory";
import { EXAMPLES, truncateId } from "@/lib/constants";
import { getTxHeuristicSteps } from "@/lib/analysis/orchestrator";
import { SelfHostRow } from "./SelfHostRow";
import { detectInputType, cleanInput } from "@/lib/analysis/detect-input";
import { formatBtc, fmtN } from "@/lib/format";
import { COLORS, V2_LIGHT_PALETTE, hexToRgba } from "@/lib/palette";
import { useV2Palette } from "../useV2Palette";
import { useNetwork } from "@/context/NetworkContext";
import { useExperienceMode } from "@/hooks/useExperienceMode";
import { useDevMode } from "@/hooks/useDevMode";
import type { RecentScan } from "@/hooks/useRecentScans";
import type { Bookmark } from "@/hooks/useBookmarks";
import { GlassField, type FieldLabel } from "./GlassField";
import { FIELD_TX } from "./field-data";
import { buildFieldUtxos, labelKind, scriptLabel } from "./field-labels";
import { HowItWorks } from "./HowItWorks";
import { WhenVisible } from "./WhenVisible";

const DevChainalysisPanel = lazy(() => import("@/components/DevChainalysisPanel").then(m => ({ default: m.DevChainalysisPanel })));
const LensExplainer = lazy(() => import("./LensExplainer").then(m => ({ default: m.LensExplainer })));

export interface V2HomeProps {
  onSubmit: (input: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  scans: RecentScan[];
  bookmarks: Bookmark[];
  onClearScans: () => void;
  onRemoveBookmark: (id: string) => void;
  onClearBookmarks: () => void;
  onExportBookmarks?: () => void;
  onImportBookmarks?: ((json: string) => { imported: number; error?: string }) | undefined;
}

const UTXOS = buildFieldUtxos(FIELD_TX);
const SPLIT = (a: number) => `${-a}px 0 ${COLORS.severityLow}, ${a}px 0 ${COLORS.severityCritical}`;
/** Four specimens spanning the grade range; grades are the ones EXAMPLES declares. */
const SPECIMEN_KEYS = ["page.example_whirlpool", "page.example_stonewall", "page.example_opreturn", "page.example_satoshi"];
const SPECIMENS = EXAMPLES.filter((e) => SPECIMEN_KEYS.includes(e.labelKey));
const MORE_EXAMPLES = EXAMPLES.filter((e) => !SPECIMEN_KEYS.includes(e.labelKey));
const FOCUS = "focus-visible:outline-2 focus-visible:outline-bitcoin focus-visible:outline-offset-2";

export function V2Home({
  onSubmit, inputRef, scans, bookmarks, onClearScans, onRemoveBookmark, onClearBookmarks, onExportBookmarks, onImportBookmarks,
}: V2HomeProps) {
  const { t } = useTranslation();
  const { network } = useNetwork();
  const { devMode } = useDevMode();
  const { proMode } = useExperienceMode();
  const reduced = useReducedMotion();
  const P = useV2Palette();
  const BG = (a: number) => hexToRgba(P.background, a);
  // A soft halo on paper; the full glow reads as a smudge on white.
  const GLOW = `0 0 40px ${hexToRgba(COLORS.bitcoin, P === V2_LIGHT_PALETTE ? 0.12 : 0.35)}`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [locked, setLocked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Every check the scan runs (heuristics + chain analysis), as on the scan screen.
  const checks = getTxHeuristicSteps().length;
  const showHistory = scans.length > 0 || proMode;

  const labels = useMemo<FieldLabel[]>(() => UTXOS.map((u) => {
    const kind = labelKind(u);
    const title = kind === "dust"
      ? t("v2.home.field_dust", { defaultValue: "Dust · {{sats}} sats", sats: fmtN(u.value) })
      : u.side === "in"
        ? kind === "round" ? t("v2.home.field_input_round", { defaultValue: "Input · round amount" }) : t("v2.home.field_input", { defaultValue: "Input" })
        : kind === "anon-set"
          ? t("v2.home.field_output_anon", { defaultValue: "CoinJoin output · anon set {{n}}", n: u.anonSet })
          : kind === "round"
            ? t("v2.home.field_output_round", { defaultValue: "CoinJoin output · round amount" })
            : t("v2.home.field_output", { defaultValue: "CoinJoin output" });
    return { title, sub: `${formatBtc(u.value)} · ${scriptLabel(u.scriptType)}`, color: { dust: P.severityCritical, "anon-set": P.severityGood, round: P.severityMedium, plain: P.muted }[kind] };
  }), [t, P]);

  const captions = useMemo(() => ({
    inView: (n: number) => t("v2.home.lens_in_view", { defaultValue: "LENS ×1.7 · {{n}} UTXOS IN VIEW", n }),
    locked: t("v2.home.lens_locked", { defaultValue: "TARGET LOCKED · {{n}} CHECKS QUEUED", n: checks }),
    hubTitle: t("v2.home.hub_title", { defaultValue: "WabiSabi CoinJoin" }),
    hubSub: t("v2.home.hub_sub", { defaultValue: "{{inputs}} in / {{outputs}} out", inputs: FIELD_TX.inValues.length, outputs: FIELD_TX.outValues.length }),
  }), [t, checks]);

  const fieldSource = t("v2.home.field_source", { defaultValue: "Background: a real WabiSabi CoinJoin, {{inputs}} inputs, {{outputs}} outputs", inputs: FIELD_TX.inValues.length, outputs: FIELD_TX.outValues.length });
  const scanField = (
    <button
      type="button"
      onClick={() => onSubmit(FIELD_TX.txid)}
      className={`inline-flex items-center align-middle min-h-[44px] max-sm:px-1 max-sm:-my-3 text-muted hover:text-bitcoin underline underline-offset-4 decoration-hairline-strong cursor-pointer rounded ${FOCUS}`}
    >
      {t("v2.home.field_scan", { defaultValue: "Scan it" })}
    </button>
  );

  const onFieldInput = (e: FormEvent<HTMLDivElement>) => {
    const el = e.target as HTMLInputElement;
    if (el.id !== "main-input") return;
    const v = cleanInput(el.value);
    setLocked(!!v && detectInputType(v, network) !== "invalid");
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, y: -10, filter: "blur(4px)" }}
      transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="w-full"
      data-testid="v2-home"
    >
      <section ref={heroRef} className="relative isolate overflow-hidden sm:min-h-[calc(100svh-3.5rem)] flex flex-col">
        <GlassField utxos={UTXOS} labels={labels} captions={captions} locked={locked} lockTarget={fieldRef} avoid={heroRef} counter={counterRef} />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-[5] pointer-events-none"
          style={{ background: `radial-gradient(ellipse 50% 46% at 50% 50%, ${BG(0.9)} 0%, ${BG(0.62)} 50%, ${BG(0)} 100%), linear-gradient(180deg, ${BG(0.6)}, ${BG(0)} 16%, ${BG(0)} 82%, ${P.background})` }}
        />

        <div data-keepout className="flex-1 flex flex-col items-center justify-center w-full max-w-[760px] mx-auto px-4 pt-10 sm:pt-14 pb-8 sm:pb-10 text-center">
          <p className="inline-flex items-center gap-2.5 font-mono text-[10px] sm:text-[11px] tracking-[0.1em] sm:tracking-[0.16em] uppercase text-muted mb-5">
            <span className="relative flex size-[7px]" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-severity-critical opacity-60 motion-safe:animate-ping" />
              <span className="relative size-[7px] rounded-full bg-severity-critical" />
            </span>
            {t("v2.home.kicker", { defaultValue: "The chain is public. Someone is always looking." })}
          </p>

          <h1 className="font-extrabold text-[clamp(50px,10.5vw,112px)] leading-[0.92] tracking-[-0.055em] text-balance sm:whitespace-nowrap">
            {t("page.hero_prefix", { defaultValue: "Am I " })}
            <span className="relative inline-block text-(--bitcoin-display)">
              <motion.span
                className="inline-block"
                initial={{ textShadow: "0 0 0 transparent" }}
                animate={{ textShadow: reduced ? GLOW : [SPLIT(3), SPLIT(-2), GLOW] }}
                transition={{ delay: 0.9, duration: 0.5, times: [0, 0.3, 1] }}
              >
                {t("page.hero_suffix", { defaultValue: "exposed?" })}
              </motion.span>
              {/* CSS (not JS) hides the redaction for reduced motion, so SSR and client markup match. */}
              <>
                  <motion.span
                    aria-hidden="true"
                    className="absolute -left-[0.04em] -right-[0.06em] top-[0.12em] bottom-[0.02em] bg-background border border-hairline-strong origin-right motion-reduce:hidden"
                    initial={{ scaleX: 1 }}
                    animate={{ scaleX: 0 }}
                    transition={{ delay: 0.7, duration: 0.9, ease: [0.7, 0, 0.2, 1] }}
                  />
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-x-0 top-1/2 -translate-y-[40%] font-mono font-semibold text-[clamp(9px,1.1vw,12px)] tracking-[0.35em] text-faint motion-reduce:hidden"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ delay: 0.7, duration: 0.25 }}
                  >
                    REDACTED
                  </motion.span>
              </>
            </span>
          </h1>

          <p className="mt-4 sm:mt-5 max-w-[30em] text-base sm:text-[19px] leading-relaxed text-muted text-balance">
            {t("page.tagline", { defaultValue: "The Bitcoin privacy scanner you were afraid to run." })}
          </p>

          <div
            ref={fieldRef}
            onInput={onFieldInput}
            data-locked={locked}
            className="v2-hero-field relative w-full max-w-[680px] mt-6 sm:mt-8 flex flex-col items-center [&_.blur-2xl]:hidden [&_.p-px]:[background:var(--hairline-strong)]! [&:focus-within_.p-px]:[background:color-mix(in_srgb,var(--bitcoin)_45%,transparent)]! data-[locked=true]:[&_.p-px]:[background:color-mix(in_srgb,var(--bitcoin)_85%,transparent)]! data-[locked=true]:[&_.p-px]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--bitcoin)_12%,transparent),0_20px_60px_-20px_color-mix(in_srgb,var(--bitcoin)_35%,transparent)] [&_input]:bg-(--hero-field-bg)! [&_.p-px]:shadow-(--shadow-card) [&_input]:backdrop-blur-md"
          >
            <AddressInput onSubmit={onSubmit} isLoading={false} inputRef={inputRef} placeholder={t("v2.home.placeholder", { defaultValue: "Address, txid, xpub or PSBT" })} />
          </div>
          {/* Phones fold the idle checks line into the trust row; the live "locked" status shows everywhere. */}
          <p className={`${locked ? "mt-3" : "sm:mt-3"} font-mono text-xs text-faint`} aria-live="polite">
            {locked
              ? <span className="text-bitcoin">{t("v2.home.status_locked", { defaultValue: "Target locked. Press Scan or Enter." })}</span>
              : <span className="hidden sm:inline">{t("v2.home.status_checks", { defaultValue: "{{count}} transaction checks run locally in this browser.", count: checks })}</span>}
          </p>

          <div className="mt-6 sm:mt-7 w-full grid grid-cols-2 sm:grid-cols-4 gap-2.5" aria-label={t("v2.home.specimens", { defaultValue: "Example scans" })} role="group">
            {SPECIMENS.map((ex) => (
              <button
                key={ex.input}
                type="button"
                onClick={() => onSubmit(ex.input)}
                className={`text-left min-h-[44px] rounded-xl border border-hairline bg-surface-1/80 shadow-(--shadow-sm) backdrop-blur-md px-3 py-2.5 hover:border-hairline-strong hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 transition-[translate,border-color] duration-200 cursor-pointer ${FOCUS}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">{t(ex.labelKey, { defaultValue: ex.labelDefault })}</span>
                  <span className={`text-xl font-extrabold leading-none tracking-tight ${ex.hintColor}`}>{ex.hint}</span>
                </span>
                <span className="block mt-1.5 v2-num text-[11px] text-faint truncate">{truncateId(ex.input)}</span>
              </button>
            ))}
          </div>

          {!showHistory && (
            <div className="mt-2 w-full">
              <button
                type="button"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
                className={`min-h-[44px] px-3 text-sm text-muted hover:text-foreground transition-colors cursor-pointer rounded-lg ${FOCUS}`}
              >
                {moreOpen
                  ? t("v2.home.fewer_examples", { defaultValue: "Fewer examples" })
                  : t("v2.home.more_examples", { defaultValue: "{{count}} more examples", count: MORE_EXAMPLES.length })}
              </button>
              {moreOpen && (
                <ul className="mt-1 flex flex-wrap justify-center gap-2">
                  {MORE_EXAMPLES.map((ex) => (
                    <li key={ex.input}>
                      <button
                        type="button"
                        onClick={() => onSubmit(ex.input)}
                        className={`inline-flex items-center gap-2 min-h-[44px] rounded-lg border border-hairline bg-surface-1/80 backdrop-blur-md px-3 text-sm text-muted hover:text-foreground hover:border-hairline-strong transition-colors cursor-pointer ${FOCUS}`}
                      >
                        {t(ex.labelKey, { defaultValue: ex.labelDefault })}
                        <span className={`font-semibold ${ex.hintColor}`}>{ex.hint}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {showHistory && (
            <div className="mt-6 w-full flex justify-center rounded-xl bg-surface-1/75 backdrop-blur-md border border-hairline p-3 text-left">
              <ScanHistory
                scans={scans}
                bookmarks={proMode ? bookmarks : []}
                examples={EXAMPLES}
                onSelect={onSubmit}
                onClearScans={onClearScans}
                onRemoveBookmark={onRemoveBookmark}
                onClearBookmarks={onClearBookmarks}
                onExportBookmarks={proMode ? onExportBookmarks : undefined}
                onImportBookmarks={proMode ? onImportBookmarks : undefined}
              />
            </div>
          )}

          {devMode && (
            <Suspense fallback={null}>
              <div className="mt-6 w-full"><DevChainalysisPanel /></div>
            </Suspense>
          )}

          <ul className="mt-5 sm:mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 font-mono text-xs text-muted">
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-severity-good" aria-hidden="true" />
              <span className="sm:hidden">{t("v2.home.trust_checks", { defaultValue: "{{count}} checks, all local", count: checks })}</span>
              <span className="hidden sm:inline">{t("page.trust_client", { defaultValue: "100% client-side" })}</span>
            </li>
            <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-severity-good" aria-hidden="true" />{t("page.trust_tracking", { defaultValue: "No tracking" })}</li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-severity-good" aria-hidden="true" />
              <a href="https://github.com/Copexit/am-i-exposed" target="_blank" rel="noopener noreferrer" className={`hover:text-foreground transition-colors underline-offset-4 hover:underline rounded ${FOCUS}`}>
                {t("page.trust_opensource", { defaultValue: "Open source" })}
              </a>
            </li>
          </ul>
        </div>

        {/* Phones get this caption at the end of the page instead (see below). */}
        <div data-keepout className="hidden sm:flex px-6 pb-3 flex-wrap items-center gap-x-3 font-mono text-[10.5px] tracking-[0.04em] text-faint">
          <span>{fieldSource}</span>
          {scanField}
          <span className="motion-reduce:hidden">
            {t("v2.home.field_count", { defaultValue: "UTXOs labelled while you watched:" })}{" "}
            <span ref={counterRef} className="v2-num text-muted">0</span>
          </span>
        </div>
      </section>

      <WhenVisible minHeight={720}>
        <Suspense fallback={<div className="min-h-[720px]" />}>
          <LensExplainer onScan={onSubmit} />
        </Suspense>
      </WhenVisible>

      <HowItWorks checks={checks} />
      <SelfHostRow />
      <p className="sm:hidden px-4 font-mono text-[10.5px] leading-relaxed tracking-[0.04em] text-faint">
        {fieldSource}{" "}{scanField}
      </p>
    </motion.div>
  );
}
