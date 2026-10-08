"use client";

import { Suspense, lazy, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { motion, useReducedMotion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { AddressInput } from "@/components/AddressInput";
import { ScanHistory } from "@/components/ScanHistory";
import { EXAMPLES, truncateId } from "@/lib/constants";
import { getTxHeuristicSteps } from "@/lib/analysis/heuristic-steps";
import { SelfHostRow } from "./SelfHostRow";
import { detectInputType, cleanInput } from "@/lib/analysis/detect-input";
import { formatBtc, fmtN } from "@/lib/format";
import { COLORS, LIGHT_PALETTE, hexToRgba } from "@/lib/palette";
import { usePalette } from "@/hooks/usePalette";
import { useNetwork } from "@/context/NetworkContext";
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

export interface HomeProps {
  onSubmit: (input: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  scans: RecentScan[];
  bookmarks: Bookmark[];
  onClearScans: () => void;
  onRemoveBookmark: (id: string) => void;
  onClearBookmarks: () => void;
  onExportBookmarks?: (opts?: { includeWallets?: boolean }) => void;
  onImportBookmarks?: ((json: string) => { imported: number; error?: string }) | undefined;
}

const UTXOS = buildFieldUtxos(FIELD_TX);
const SPLIT = (a: number) => `${-a}px 0 ${COLORS.severityLow}, ${a}px 0 ${COLORS.severityCritical}`;
/** Four specimens spanning the grade range; grades are the ones EXAMPLES declares. */
const SPECIMEN_KEYS = ["page.example_whirlpool", "page.example_sweep", "page.example_consolidation", "page.example_reuse"];
const SPECIMENS = EXAMPLES.filter((e) => SPECIMEN_KEYS.includes(e.labelKey));
const MORE_EXAMPLES = EXAMPLES.filter((e) => !SPECIMEN_KEYS.includes(e.labelKey));
const FOCUS = "focus-visible:outline-2 focus-visible:outline-bitcoin focus-visible:outline-offset-2";

export function Home({
  onSubmit, inputRef, scans, bookmarks, onClearScans, onRemoveBookmark, onClearBookmarks, onExportBookmarks, onImportBookmarks,
}: HomeProps) {
  const { t } = useTranslation();
  const { network } = useNetwork();
  const { devMode } = useDevMode();
  const reduced = useReducedMotion();
  const P = usePalette();
  const BG = (a: number) => hexToRgba(P.background, a);
  // A soft halo on paper; the full glow reads as a smudge on white.
  const GLOW = `0 0 40px ${hexToRgba(COLORS.bitcoin, P === LIGHT_PALETTE ? 0.12 : 0.35)}`;
  const fieldRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const [locked, setLocked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const trustRef = useRef<HTMLUListElement>(null);
  const cueRef = useRef<HTMLButtonElement>(null);
  const [cueFits, setCueFits] = useState(false);
  // The "see more" cue sits in the hero's bottom space; where the hero content already fills it (short phones), it hides.
  useEffect(() => {
    const hero = heroRef.current, content = contentRef.current, trust = trustRef.current, cue = cueRef.current;
    if (!hero || !content || !trust || !cue) return;
    const fit = () => setCueFits(cue.getBoundingClientRect().top - trust.getBoundingClientRect().bottom >= 8);
    const ro = new ResizeObserver(fit);
    ro.observe(hero);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
  // Every check the scan runs (heuristics + chain analysis), as on the scan screen.
  const checks = getTxHeuristicSteps().length;
  const showHistory = scans.length > 0 || bookmarks.length > 0;

  const labels = useMemo<FieldLabel[]>(() => UTXOS.map((u) => {
    const kind = labelKind(u);
    const title = kind === "dust"
      ? t("home.field_dust", { defaultValue: "Dust · {{sats}} sats", sats: fmtN(u.value) })
      : u.side === "in"
        ? kind === "round" ? t("home.field_input_round", { defaultValue: "Input · round amount" }) : t("home.field_input", { defaultValue: "Input" })
        : kind === "anon-set"
          ? t("home.field_output_anon", { defaultValue: "CoinJoin output · anon set {{n}}", n: u.anonSet })
          : kind === "round"
            ? t("home.field_output_round", { defaultValue: "CoinJoin output · round amount" })
            : t("home.field_output", { defaultValue: "CoinJoin output" });
    return { title, sub: `${formatBtc(u.value)} · ${scriptLabel(u.scriptType)}`, color: { dust: P.severityCritical, "anon-set": P.severityGood, round: P.severityMedium, plain: P.muted }[kind] };
  }), [t, P]);

  const captions = useMemo(() => ({
    inView: (n: number) => t("home.lens_in_view", { defaultValue: "LENS ×1.7 · {{n}} UTXOS IN VIEW", n }),
    locked: t("home.lens_locked", { defaultValue: "TARGET LOCKED · {{n}} CHECKS QUEUED", n: checks }),
    hubTitle: t("home.hub_title", { defaultValue: "WabiSabi CoinJoin" }),
    hubSub: t("home.hub_sub", { defaultValue: "{{inputs}} in / {{outputs}} out", inputs: FIELD_TX.inValues.length, outputs: FIELD_TX.outValues.length }),
  }), [t, checks]);

  const fieldSource = t("home.field_source", { defaultValue: "Background: a real WabiSabi CoinJoin, {{inputs}} inputs, {{outputs}} outputs", inputs: FIELD_TX.inValues.length, outputs: FIELD_TX.outValues.length });
  const scanField = (
    <button
      type="button"
      onClick={() => onSubmit(FIELD_TX.txid)}
      className={`inline-flex items-center align-middle min-h-[44px] max-sm:px-1 max-sm:-my-3 text-muted hover:text-bitcoin underline underline-offset-4 decoration-hairline-strong cursor-pointer rounded ${FOCUS}`}
    >
      {t("home.field_scan", { defaultValue: "Scan it" })}
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
      data-testid="home"
    >
      {/* The first screen is exactly the hero: it fills the space under the header (and the phone privacy notice) and centers its content, so the lens always starts below the fold. */}
      <section ref={heroRef} className="relative isolate overflow-hidden min-h-[calc(100svh-var(--header-h,3.5rem)-var(--notice-h,0px))] flex flex-col">
        <GlassField utxos={UTXOS} labels={labels} captions={captions} locked={locked} lockTarget={fieldRef} avoid={heroRef} counter={counterRef} />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-[5] pointer-events-none"
          style={{ background: `radial-gradient(ellipse 50% 46% at 50% 50%, ${BG(0.9)} 0%, ${BG(0.62)} 50%, ${BG(0)} 100%), linear-gradient(180deg, ${BG(0.6)}, ${BG(0)} 16%, ${BG(0)} 82%, ${P.background})` }}
        />

        <div ref={contentRef} data-keepout className="flex-1 flex flex-col items-center justify-center w-full max-w-[760px] mx-auto px-4 pt-6 sm:pt-14 pb-6 sm:pb-10 text-center">
          <p className="inline-flex items-center gap-2.5 font-mono text-[9px] min-[360px]:text-[10px] sm:text-[11px] tracking-[0.05em] sm:tracking-[0.16em] whitespace-nowrap uppercase text-muted mb-5">
            <span className="relative flex size-[7px]" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-severity-critical opacity-60 motion-safe:animate-ping" />
              <span className="relative size-[7px] rounded-full bg-severity-critical" />
            </span>
            {t("home.kicker", { defaultValue: "The chain is public. Someone is always looking." })}
          </p>

          <h1 className="font-extrabold text-[clamp(50px,10.5vw,112px)] leading-[0.92] tracking-[-0.055em] text-balance sm:whitespace-nowrap">
            {t("page.hero_prefix", { defaultValue: "Am I " })}
            <span className="relative inline-block text-(--bitcoin-display)">
              <motion.span
                className="inline-block"
                initial={{ textShadow: "0 0 0 transparent" }}
                animate={{ textShadow: reduced ? GLOW : [SPLIT(3), SPLIT(-2), GLOW] }}
                transition={{ delay: 0.3, duration: 0.5, times: [0, 0.3, 1] }}
              >
                {t("page.hero_suffix", { defaultValue: "exposed?" })}
              </motion.span>
            </span>
          </h1>

          <p className="mt-4 sm:mt-5 max-w-[30em] text-base sm:text-[19px] leading-relaxed text-muted text-balance">
            {t("page.tagline", { defaultValue: "The Bitcoin privacy scanner you were afraid to run." })}
          </p>

          <div
            ref={fieldRef}
            onInput={onFieldInput}
            data-locked={locked}
            className="hero-field relative w-full max-w-[680px] mt-6 sm:mt-8 flex flex-col items-center [&_.blur-2xl]:hidden [&_.p-px]:[background:var(--hairline-strong)]! [&:focus-within_.p-px]:[background:color-mix(in_srgb,var(--bitcoin)_45%,transparent)]! data-[locked=true]:[&_.p-px]:[background:color-mix(in_srgb,var(--bitcoin)_85%,transparent)]! data-[locked=true]:[&_.p-px]:shadow-[0_0_0_4px_color-mix(in_srgb,var(--bitcoin)_12%,transparent),0_20px_60px_-20px_color-mix(in_srgb,var(--bitcoin)_35%,transparent)] [&_input]:bg-(--hero-field-bg)! [&_.p-px]:shadow-(--shadow-card) [&_input]:backdrop-blur-md"
          >
            <AddressInput onSubmit={onSubmit} isLoading={false} inputRef={inputRef} />
          </div>
          {/* Phones fold the idle checks line into the trust row; the live "locked" status shows everywhere. */}
          <p className={`${locked ? "mt-3" : "sm:mt-3"} font-mono text-xs text-faint`} aria-live="polite">
            {locked
              ? <span className="text-bitcoin">{t("home.status_locked", { defaultValue: "Target locked. Press Scan or Enter." })}</span>
              : <span className="hidden sm:inline">{t("home.status_checks", { defaultValue: "{{count}} transaction checks run locally in this browser.", count: checks })}</span>}
          </p>

          <div className="mt-6 sm:mt-7 w-full grid grid-cols-2 sm:grid-cols-4 gap-2.5" aria-label={t("home.specimens", { defaultValue: "Example scans" })} role="group">
            {SPECIMENS.map((ex) => (
              <button
                key={ex.input}
                type="button"
                onClick={() => onSubmit(ex.input)}
                className={`flex flex-col justify-between text-left min-h-[44px] rounded-xl border border-hairline bg-surface-1/80 shadow-(--shadow-sm) backdrop-blur-md px-3 py-2.5 hover:border-hairline-strong hover:-translate-y-0.5 motion-reduce:hover:translate-y-0 transition-[translate,border-color] duration-200 cursor-pointer ${FOCUS}`}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 text-sm leading-snug font-semibold text-foreground hyphens-auto break-words">{t(ex.labelKey, { defaultValue: ex.labelDefault })}</span>
                  <span className={`text-xl font-extrabold leading-none tracking-tight ${ex.hintColor}`}>{ex.hintKey ? t(ex.hintKey, { defaultValue: ex.hint }) : ex.hint}</span>
                </span>
                <span className="block mt-1.5 num text-[11px] text-faint truncate">{truncateId(ex.input)}</span>
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
                  ? t("home.fewer_examples", { defaultValue: "Fewer examples" })
                  : t("home.more_examples", { defaultValue: "{{count}} more examples", count: MORE_EXAMPLES.length })}
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
                        <span className={`font-semibold ${ex.hintColor}`}>{ex.hintKey ? t(ex.hintKey, { defaultValue: ex.hint }) : ex.hint}</span>
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
                bookmarks={bookmarks}
                examples={EXAMPLES}
                onSelect={onSubmit}
                onClearScans={onClearScans}
                onRemoveBookmark={onRemoveBookmark}
                onClearBookmarks={onClearBookmarks}
                onExportBookmarks={onExportBookmarks}
                onImportBookmarks={onImportBookmarks}
              />
            </div>
          )}

          {devMode && (
            <Suspense fallback={null}>
              <div className="mt-6 w-full"><DevChainalysisPanel /></div>
            </Suspense>
          )}

          <ul ref={trustRef} className="mt-5 sm:mt-7 flex flex-wrap justify-center gap-x-5 gap-y-2 font-mono text-xs text-muted">
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-severity-good" aria-hidden="true" />
              <span className="sm:hidden">{t("home.trust_checks", { defaultValue: "{{count}} checks, all local", count: checks })}</span>
              <span className="hidden sm:inline">{t("page.trust_client", { defaultValue: "100% client-side" })}</span>
            </li>
            <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-severity-good" aria-hidden="true" />{t("page.trust_tracking", { defaultValue: "No tracking" })}</li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-severity-good" aria-hidden="true" />
              <a href="https://github.com/Copexit/am-i-exposed" target="_blank" rel="noopener noreferrer" className={`inline-block py-1 -my-1 hover:text-foreground transition-colors underline-offset-4 hover:underline rounded ${FOCUS}`}>
                {t("page.trust_opensource", { defaultValue: "Open source" })}
              </a>
            </li>
          </ul>
        </div>

        {/* Zero height, so the cue never pushes the lens below the fold. */}
        <div data-keepout className="relative h-0">
          <button
            ref={cueRef}
            type="button"
            onClick={() => (document.getElementById("lens") ?? heroRef.current?.nextElementSibling)?.scrollIntoView()}
            className={`${cueFits ? "" : "invisible"} group absolute bottom-1 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 min-h-[44px] px-3 whitespace-nowrap font-mono text-[11px] tracking-[0.12em] uppercase text-muted hover:text-foreground transition-colors cursor-pointer rounded-lg ${FOCUS}`}
          >
            {t("home.scroll_cue", { defaultValue: "See how it works" })}
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-hover:translate-y-0.5 motion-reduce:transition-none" />
          </button>
        </div>

        {/* Phones get this caption at the end of the page instead (see below). */}
        <div data-keepout className="hidden sm:flex px-6 pb-3 flex-wrap items-center gap-x-3 font-mono text-[10.5px] tracking-[0.04em] text-faint">
          <span>{fieldSource}</span>
          {scanField}
          <span className="motion-reduce:hidden">
            {t("home.field_count", { defaultValue: "UTXOs labelled while you watched:" })}{" "}
            <span ref={counterRef} className="num text-muted">0</span>
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
