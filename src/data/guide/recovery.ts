/** Recovery flow data - shared between RecoveryFlow component and /guide page */

interface RecoveryStep {
  titleKey: string;
  titleDefault: string;
  descKey: string;
  descDefault: string;
  severity: "critical" | "high" | "medium" | "good";
}

export const RECOVERY_STEPS: RecoveryStep[] = [
  {
    titleKey: "recoveryFlow.step1Title",
    titleDefault: "Move funds to a privacy-focused wallet",
    descKey: "recoveryFlow.step1Desc",
    descDefault: "Transfer your compromised UTXOs to Sparrow Wallet or Ashigaru. These wallets give you coin control and proper change address management.",
    severity: "critical",
  },
  {
    titleKey: "recoveryFlow.step2Title",
    titleDefault: "CoinJoin your UTXOs",
    descKey: "recoveryFlow.step2Desc",
    descDefault: "Run your funds through Whirlpool (Sparrow/Ashigaru), JoinMarket, or Wasabi (WabiSabi) to break the transaction graph. Each CoinJoin cycle adds anonymity set members.",
    severity: "high",
  },
  {
    titleKey: "recoveryFlow.step3Title",
    titleDefault: "Wait several blocks before spending",
    descKey: "recoveryFlow.step3Desc",
    descDefault: "After CoinJoin, let the outputs sit for at least 10-20 blocks. Spending immediately after mixing is a timing correlation signal that weakens your privacy.",
    severity: "medium",
  },
  {
    titleKey: "recoveryFlow.step4Title",
    titleDefault: "Spend with coin control - one UTXO per transaction",
    descKey: "recoveryFlow.step4Desc",
    descDefault: "Select individual UTXOs for each payment using coin control. Prefer spending a single post-mix UTXO per transaction. If one UTXO is not enough, consolidate only the minimum needed for that payment - consider using Stonewall to add ambiguity. Never consolidate all post-mix UTXOs together.",
    severity: "medium",
  },
  {
    titleKey: "recoveryFlow.step5Title",
    titleDefault: "Send to a fresh address",
    descKey: "recoveryFlow.step5Desc",
    descDefault: "Always send to a fresh, never-used address from the receiver. If you control the receiving wallet, generate a new address for each receive.",
    severity: "good",
  },
];

export const RECOVERY_TOOLS = [
  { name: "Sparrow Wallet", url: "https://sparrowwallet.com" },
  { name: "Ashigaru", url: "https://ashigaru.rs" },
  { name: "UnstoppableSwap", url: "https://unstoppableswap.net" },
];
