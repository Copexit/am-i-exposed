"use client";

import { motion } from "motion/react";
import { CexRiskPanel } from "../CexRiskPanel";
import { ExchangeWarningPanel } from "../ExchangeWarningPanel";
import { CommonMistakes } from "../CommonMistakes";
import { useExperienceMode } from "@/hooks/useExperienceMode";
import type { ScoringResult } from "@/lib/types";
import type { MempoolTransaction } from "@/lib/api/types";

export function SidebarWarnings({
  query,
  inputType,
  txData,
  isCoinJoin,
  result,
}: {
  query: string;
  inputType: "txid" | "address";
  txData: MempoolTransaction | null;
  isCoinJoin: boolean;
  result: ScoringResult;
}) {
  const { proMode } = useExperienceMode();
  return (
    <div className="w-full flex flex-col gap-3 sm:gap-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.52 }} className="w-full">
        <CexRiskPanel
          query={query}
          inputType={inputType}
          txData={txData}
          isCoinJoin={isCoinJoin}
        />
      </motion.div>
      {isCoinJoin && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.54 }} className="w-full">
          <ExchangeWarningPanel />
        </motion.div>
      )}
      {proMode && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.56 }} className="w-full">
          <CommonMistakes findings={result.findings} grade={result.grade} />
        </motion.div>
      )}
    </div>
  );
}
