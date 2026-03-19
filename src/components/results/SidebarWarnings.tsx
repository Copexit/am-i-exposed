"use client";

import { motion } from "motion/react";
import { CexRiskPanel } from "../CexRiskPanel";
import { ExchangeWarningPanel } from "../ExchangeWarningPanel";
import { CommonMistakes } from "../CommonMistakes";
import { fadeUpVariants, fadeUpTransition } from "./animations";
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
      {proMode && (
        <motion.div {...fadeUpVariants} transition={fadeUpTransition(0.52)} className="w-full">
          <CexRiskPanel
            query={query}
            inputType={inputType}
            txData={txData}
            isCoinJoin={isCoinJoin}
          />
        </motion.div>
      )}
      {isCoinJoin && (
        <motion.div {...fadeUpVariants} transition={fadeUpTransition(0.54)} className="w-full">
          <ExchangeWarningPanel />
        </motion.div>
      )}
      {proMode && (
        <motion.div {...fadeUpVariants} transition={fadeUpTransition(0.56)} className="w-full">
          <CommonMistakes findings={result.findings} grade={result.grade} />
        </motion.div>
      )}
    </div>
  );
}
