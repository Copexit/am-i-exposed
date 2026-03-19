import type { Finding, ScoringResult, TxType } from "@/lib/types";
import type { PrimaryRec } from "@/lib/recommendations/primary-recommendation";
import type { WalletAuditResult } from "@/lib/analysis/wallet-audit";
import type { MempoolTransaction } from "@/lib/api/types";
import { formatSats } from "@/lib/format";
import {
  severityLabel,
  formatGrade,
  formatScore,
  dim,
  bold,
  header,
} from "./colors";

const VERSION = "0.34.3";

function line(label: string, value: string): string {
  return `${dim(label.padEnd(13))}${value}`;
}

// ---- Transaction ----

export function formatTxResult(
  txid: string,
  result: ScoringResult,
  tx: MempoolTransaction,
  network: string,
  rec?: PrimaryRec | null,
): string {
  const lines: string[] = [];
  lines.push(dim(`am-i-exposed v${VERSION}`));
  lines.push("");
  lines.push(line("Transaction:", txid));
  lines.push(line("Network:", network));
  if (result.txType && result.txType !== "unknown") {
    lines.push(line("Type:", formatTxType(result.txType)));
  }
  lines.push(
    line(
      "Inputs:",
      `${tx.vin.length} (${formatSats(tx.vin.reduce((s, v) => s + (v.prevout?.value ?? 0), 0))})`,
    ),
  );
  lines.push(
    line(
      "Outputs:",
      `${tx.vout.length} (${formatSats(tx.vout.reduce((s, v) => s + v.value, 0))})`,
    ),
  );
  lines.push(line("Fee:", formatSats(tx.fee)));
  lines.push("");
  lines.push(
    `Score: ${formatScore(result.score, result.grade)}   Grade: ${formatGrade(result.grade)}`,
  );
  lines.push("");
  lines.push(formatFindings(result.findings));

  if (rec) {
    lines.push("");
    lines.push(formatRecommendation(rec));
  }

  return lines.join("\n");
}

// ---- Address ----

export function formatAddressResult(
  address: string,
  result: ScoringResult,
  network: string,
  rec?: PrimaryRec | null,
): string {
  const lines: string[] = [];
  lines.push(dim(`am-i-exposed v${VERSION}`));
  lines.push("");
  lines.push(line("Address:", address));
  lines.push(line("Network:", network));
  lines.push("");
  lines.push(
    `Score: ${formatScore(result.score, result.grade)}   Grade: ${formatGrade(result.grade)}`,
  );
  lines.push("");
  lines.push(formatFindings(result.findings));

  if (rec) {
    lines.push("");
    lines.push(formatRecommendation(rec));
  }

  return lines.join("\n");
}

// ---- Wallet ----

export function formatWalletResult(
  descriptor: string,
  result: WalletAuditResult,
  network: string,
): string {
  const lines: string[] = [];
  lines.push(dim(`am-i-exposed v${VERSION}`));
  lines.push("");
  lines.push(line("Wallet:", descriptor.length > 40 ? descriptor.slice(0, 37) + "..." : descriptor));
  lines.push(line("Network:", network));
  lines.push(line("Active addrs:", String(result.activeAddresses)));
  lines.push(line("Transactions:", String(result.totalTxs)));
  lines.push(line("UTXOs:", String(result.totalUtxos)));
  lines.push(line("Balance:", `${formatSats(result.totalBalance)} sats`));
  lines.push(line("Reused addrs:", String(result.reusedAddresses)));
  lines.push(line("Dust UTXOs:", String(result.dustUtxos)));
  lines.push("");
  lines.push(
    `Score: ${formatScore(result.score, result.grade)}   Grade: ${formatGrade(result.grade)}`,
  );
  lines.push("");
  lines.push(formatFindings(result.findings));

  return lines.join("\n");
}

// ---- Shared ----

function formatFindings(findings: Finding[]): string {
  if (findings.length === 0) return dim("No findings.");

  const lines: string[] = [];
  lines.push(header(`FINDINGS (${findings.length}):`));

  for (const f of findings) {
    const impact =
      f.scoreImpact > 0
        ? `+${f.scoreImpact}`
        : f.scoreImpact === 0
          ? " 0"
          : String(f.scoreImpact);
    lines.push(`  ${severityLabel(f.severity)} ${f.title}  ${dim(impact)}`);
    if (f.description) {
      // Wrap long descriptions
      const desc = f.description.length > 100
        ? f.description.slice(0, 97) + "..."
        : f.description;
      lines.push(`           ${dim(desc)}`);
    }
  }

  return lines.join("\n");
}

function formatRecommendation(rec: PrimaryRec): string {
  const lines: string[] = [];
  lines.push(header("RECOMMENDATION:"));
  lines.push(`  ${bold(rec.headlineDefault)}`);
  if (rec.detailDefault) {
    lines.push(`  ${dim(rec.detailDefault.slice(0, 120))}`);
  }
  if (rec.tools && rec.tools.length > 0) {
    const toolStr = rec.tools.map((t) => `${t.name} (${t.url})`).join(", ");
    lines.push(`  ${dim("Tools: " + toolStr)}`);
  } else if (rec.tool) {
    lines.push(`  ${dim(`Tool: ${rec.tool.name} (${rec.tool.url})`)}`);
  }
  return lines.join("\n");
}

function formatTxType(txType: TxType): string {
  return txType.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
