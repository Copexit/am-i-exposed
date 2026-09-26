"use client";

import { useTranslation } from "react-i18next";
import { GRADE_VAR } from "@/lib/constants";

const GRADES = ["A+", "B", "C", "D", "F"] as const;
/** Decorative: a few finished checks tinted by severity, like the scan's checks strip. */
const CELL_TINT: Record<number, string> = {
  2: "var(--color-severity-high)", 8: "var(--color-severity-medium)", 12: "var(--color-severity-good)",
  17: "var(--color-severity-low)", 21: "var(--color-severity-good)", 25: "var(--color-severity-medium)",
};

/** Quiet three-step band: paste, checks run locally, grade + fix. */
export function HowItWorks({ checks }: { checks: number }) {
  const { t } = useTranslation();
  const cols = Math.ceil(checks / 2);
  const steps = [
    {
      title: t("v2.home.how_1_title", { defaultValue: "Paste a txid or address" }),
      body: t("v2.home.how_1_body", { defaultValue: "Mainnet, testnet4 or signet. Also works with an xpub, a descriptor or a PSBT before it is broadcast." }),
      glyph: (
        <svg viewBox="0 0 260 44" preserveAspectRatio="xMinYMid meet" fill="none" aria-hidden="true" className="w-full max-w-[200px] md:max-w-[260px] h-8 md:h-11">
          <rect x="0.5" y="4.5" width="259" height="35" rx="8" stroke="var(--hairline-strong)" />
          <text x="14" y="26.5" fill="var(--faint)" fontFamily="var(--font-geist-mono)" fontSize="11">323df21f0b0756f9...dec2</text>
          <rect x="206" y="11" width="44" height="22" rx="5" fill="var(--bitcoin)" />
        </svg>
      ),
    },
    {
      title: t("v2.home.how_2_title", { defaultValue: "{{count}} checks run in your browser", count: checks }),
      body: t("v2.home.how_2_body", { defaultValue: "Change detection, common input ownership, round amounts, wallet fingerprints, entropy and more. The result is computed on this device and never uploaded." }),
      glyph: (
        <svg viewBox="0 0 260 44" preserveAspectRatio="xMinYMid meet" aria-hidden="true" className="w-full max-w-[200px] md:max-w-[260px] h-8 md:h-11">
          {Array.from({ length: checks }, (_, i) => (
            <rect key={i} x={(i % cols) * (260 / cols)} y={i < cols ? 3 : 25} width={260 / cols - 4} height={16} rx={2.5} fill={CELL_TINT[i] ?? "var(--hairline-strong)"} />
          ))}
        </svg>
      ),
    },
    {
      title: t("v2.home.how_3_title", { defaultValue: "A grade and a concrete fix" }),
      body: t("v2.home.how_3_body", { defaultValue: "A privacy score from A+ to F, every finding explained, and the next step that repairs it." }),
      glyph: (
        <div aria-hidden="true" className="h-8 md:h-11 flex items-center gap-3.5 md:gap-5 text-[22px] md:text-[30px] font-extrabold tracking-tight leading-none">
          {GRADES.map((g) => <span key={g} style={{ color: GRADE_VAR[g] }}>{g}</span>)}
        </div>
      ),
    },
  ];

  return (
    <section aria-labelledby="v2-how" className="max-w-[1360px] mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-6 sm:py-20">
      <h2 id="v2-how" className="v2-eyebrow">{t("v2.home.how_eyebrow", { defaultValue: "How it works" })}</h2>
      <p className="mt-3 mb-6 md:mb-10 text-xl sm:text-[32px] font-semibold tracking-tight leading-tight max-w-[22em] text-balance">
        {t("v2.home.how_lead", { defaultValue: "Three steps." })}{" "}
        <span className="text-muted">{t("v2.home.how_lead_muted", { defaultValue: "Only the blockchain lookup ever leaves this browser." })}</span>
      </p>
      <ol className="grid md:grid-cols-3 border-t border-hairline">
        {steps.map((s, i) => (
          // Phones: glyph on top, then "01 Title" on one line and the body indented under the title. md+: the stacked column.
          <li key={i} className={`grid grid-cols-[auto_1fr] gap-x-3 py-4 md:block md:py-7 md:pr-7 ${i ? "border-t md:border-t-0 md:border-l border-hairline md:pl-7" : ""}`}>
            <span className="row-start-2 v2-num text-xs leading-7 md:leading-normal text-bitcoin">{String(i + 1).padStart(2, "0")}</span>
            <div className="col-span-2 row-start-1 mb-2.5 md:my-5">{s.glyph}</div>
            <h3 className="row-start-2 col-start-2 text-lg font-semibold tracking-tight leading-7 md:leading-normal">{s.title}</h3>
            <p className="col-start-2 mt-1 md:mt-2 text-[14px] md:text-[14.5px] leading-normal md:leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
