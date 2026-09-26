"use client";

import { useTranslation } from "react-i18next";
import type { AdversaryTier, Finding } from "@/lib/types";
import { ADVERSARY_TIERS, type ExposureMatrix as Matrix } from "@/lib/view/findings";
import { findingKeys } from "@/lib/finding-utils";
import { SEVERITY_BG } from "./severity";

const TIER_LABEL: Record<AdversaryTier, [string, string]> = {
  passive_observer: ["adversary.passive_observer", "Public"],
  kyc_exchange: ["adversary.kyc_exchange", "KYC"],
  state_adversary: ["adversary.state_adversary", "State"],
};
const WHEN_LABEL = {
  historical: ["temporality.historical", "Past"],
  ongoing_pattern: ["temporality.ongoing_pattern", "Pattern"],
  active_risk: ["temporality.active_risk", "Active"],
} as const;

interface ExposureMatrixProps {
  matrix: Matrix;
  findings: Finding[];
  highlightId: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}

/** Who can exploit each issue (engine adversary tiers) and whether it is already permanent. */
export function ExposureMatrix({ matrix, findings, highlightId, onHover, onOpen }: ExposureMatrixProps) {
  const { t } = useTranslation();
  if (matrix.rows.length === 0) return null;
  const byId = new Map(findings.map((f) => [f.id as string, f]));

  return (
    <section aria-labelledby="v2-exposure-title" className="space-y-4" data-testid="v2-exposure">
      <div>
        <p className="v2-eyebrow mb-2">{t("v2.results.exposureEyebrow", { defaultValue: "Exposure" })}</p>
        <h3 id="v2-exposure-title" className="text-base font-semibold">{t("v2.results.exposureTitle", { defaultValue: "Who can see this" })}</h3>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-faint">
            <th scope="col" className="text-left font-normal pb-2">
              <span className="sr-only">{t("v2.results.exposureFinding", { defaultValue: "Finding" })}</span>
            </th>
            {ADVERSARY_TIERS.map((tier) => (
              <th key={tier} scope="col" className="font-normal pb-2 w-12 text-center">
                <div className="v2-num text-sm text-foreground">{matrix.perTier[tier]}</div>
                <div>{t(TIER_LABEL[tier][0], { defaultValue: TIER_LABEL[tier][1] })}</div>
              </th>
            ))}
            <th scope="col" className="font-normal pb-2 w-14 text-right">{t("v2.results.exposureWhen", { defaultValue: "When" })}</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((row) => {
            const f = byId.get(row.findingId);
            const label = f ? t(findingKeys(f.id, "title", f.params), { ...f.params, defaultValue: f.title }) : row.findingId;
            const dim = highlightId !== null && highlightId !== row.findingId;
            return (
              <tr
                key={row.findingId}
                onMouseEnter={() => onHover(row.findingId)}
                onMouseLeave={() => onHover(null)}
                className={`border-t border-hairline transition-opacity ${dim ? "opacity-40" : ""}`}
              >
                <th scope="row" className="text-left font-normal py-2 pr-2">
                  <button type="button" onClick={() => onOpen(row.findingId)} className="flex items-center gap-2 text-muted hover:text-foreground text-left">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_BG[row.severity]}`} aria-hidden="true" />
                    <span className="line-clamp-2">{label}</span>
                  </button>
                </th>
                {ADVERSARY_TIERS.map((tier) => (
                  <td key={tier} className="text-center py-2">
                    {row.tiers.has(tier)
                      ? <span className={`inline-block w-2 h-2 rounded-full ${SEVERITY_BG[row.severity]}`} role="img" aria-label={t("v2.results.exposureYes", { defaultValue: "Can exploit" })} />
                      : <span className="text-faint" aria-label={t("v2.results.exposureNo", { defaultValue: "Cannot exploit" })}>-</span>}
                  </td>
                ))}
                <td className="text-right py-2 text-faint">
                  {row.temporality ? t(WHEN_LABEL[row.temporality][0], { defaultValue: WHEN_LABEL[row.temporality][1] }) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
