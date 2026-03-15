"use client";

import { motion } from "motion/react";
import { PrimaryRecommendation } from "../PrimaryRecommendation";
import { Remediation } from "../Remediation";
import { RecoveryFlow } from "../RecoveryFlow";
import type { ScoringResult } from "@/lib/types";

export function SidebarRecommendations({
  result,
  detectedWallet,
  devMode,
}: {
  result: ScoringResult;
  detectedWallet: string | null;
  devMode: boolean;
}) {
  return (
    <div className="w-full flex flex-col gap-3 sm:gap-4">
      {/* Hidden on mobile - shown inline in main column above TX flow chart */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }} className="hidden xl:block w-full">
        <PrimaryRecommendation
          findings={result.findings}
          grade={result.grade}
          walletGuess={detectedWallet}
        />
      </motion.div>
      {devMode && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.12 }} className="w-full">
          <Remediation findings={result.findings} grade={result.grade} />
        </motion.div>
      )}
      {devMode && (result.grade === "D" || result.grade === "F") && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.14 }} className="w-full">
          <RecoveryFlow grade={result.grade} />
        </motion.div>
      )}
    </div>
  );
}
