"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Terminal,
  Bot,
  Braces,
  Shield,
  Zap,
  FileJson,
  Cpu,
  Copy,
  Check,
} from "lucide-react";
import { useState, useCallback } from "react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 p-1.5 rounded bg-surface-inset/50 hover:bg-surface-inset text-muted hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-surface-inset rounded-lg p-4 text-sm overflow-x-auto border border-border/50">
        <code className={`language-${lang}`}>{code}</code>
      </pre>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

const TOOLS = [
  {
    name: "scan_transaction",
    desc: "Run 25 privacy heuristics on a transaction. Detects CoinJoin, change outputs, wallet fingerprints, entity matches, and more.",
    example: 'am-i-exposed scan tx 323df21f...dec2 --json',
  },
  {
    name: "scan_address",
    desc: "Check address reuse, UTXO hygiene, spending patterns, entity identification, and temporal correlation.",
    example: 'am-i-exposed scan address bc1q... --json',
  },
  {
    name: "scan_psbt",
    desc: "Analyze an unsigned transaction BEFORE broadcasting. Zero network access needed. The key tool for privacy-aware transaction crafting.",
    example: 'am-i-exposed scan psbt /tmp/proposed-tx.psbt --json',
  },
  {
    name: "scan_wallet",
    desc: "Wallet-level privacy audit via xpub/zpub/descriptor. Derives addresses, scans activity, checks reuse and UTXO hygiene.",
    example: 'am-i-exposed scan xpub zpub6r... --json --gap-limit 30',
  },
  {
    name: "compute_boltzmann",
    desc: "Compute Boltzmann entropy, wallet efficiency, and the full link probability matrix. Auto-detects WabiSabi and JoinMarket for turbo mode.",
    example: 'am-i-exposed boltzmann 323df21f...dec2 --json',
  },
];

const WORKFLOWS = [
  {
    title: "Pre-broadcast privacy check",
    steps: [
      "Craft a transaction in your wallet, export as PSBT",
      "Run: am-i-exposed scan psbt <file> --json",
      'Check .grade - if D or F, modify coin selection',
      "Repeat until grade is B or better, then sign and broadcast",
    ],
  },
  {
    title: "Wallet health audit",
    steps: [
      "Export your xpub/zpub from wallet software",
      "Run: am-i-exposed scan xpub <key> --json --gap-limit 30",
      "Check reusedAddresses (should be 0) and dustUtxos (should be 0)",
      "Review findings for consolidation history and script type mixing",
    ],
  },
  {
    title: "Transaction forensics",
    steps: [
      "Run: am-i-exposed scan tx <txid> --json",
      "Check grade and txType for quick assessment",
      "For deeper analysis: am-i-exposed chain-trace <txid> --depth 3 --json",
      "Review entity proximity and taint findings",
    ],
  },
];

const MCP_CONFIG = `{
  "mcpServers": {
    "bitcoin-privacy": {
      "command": "npx",
      "args": ["-y", "am-i-exposed", "mcp"]
    }
  }
}`;

export default function AgentsPage() {
  return (
    <div className="flex-1 flex flex-col items-center px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
      <div className="w-full max-w-4xl space-y-10">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          Back to scanner
        </Link>

        {/* Title */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Bot size={32} className="text-[#28d065]" />
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              Agent Integration
            </h1>
          </div>
          <p className="text-muted text-lg leading-relaxed max-w-3xl">
            Give your AI agent the ability to analyze Bitcoin transactions for
            privacy exposure. CLI tool with JSON output, MCP server for
            structured tool calls, or import the engine directly.
          </p>
        </div>

        {/* Install */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Terminal size={22} />
            Quick Start
          </h2>
          <CodeBlock code="npm install -g am-i-exposed" />
          <p className="text-muted text-sm">
            Requires Node.js 20+. Or use <code className="text-foreground">npx am-i-exposed</code> without installing.
          </p>
        </section>

        {/* Tools */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Braces size={22} />
            Available Tools
          </h2>
          <div className="space-y-4">
            {TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="border border-border/50 rounded-lg p-4 space-y-2"
              >
                <h3 className="font-mono text-sm font-semibold text-[#28d065]">
                  {tool.name}
                </h3>
                <p className="text-muted text-sm">{tool.desc}</p>
                <CodeBlock code={tool.example} />
              </div>
            ))}
          </div>
        </section>

        {/* JSON output */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <FileJson size={22} />
            JSON Output
          </h2>
          <p className="text-muted">
            All commands with <code className="text-foreground">--json</code> return a consistent envelope:
          </p>
          <CodeBlock
            lang="json"
            code={`{
  "score": 95,
  "grade": "A+",
  "txType": "whirlpool-coinjoin",
  "findings": [
    {
      "id": "h4-whirlpool",
      "severity": "good",
      "title": "Whirlpool CoinJoin detected",
      "scoreImpact": 30,
      "confidence": "deterministic"
    }
  ],
  "recommendation": {
    "urgency": "when-convenient",
    "headline": "Maintain UTXO separation"
  }
}`}
          />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-sm">
            {[
              { grade: "A+", range: "90-100", color: "text-[#28d065]" },
              { grade: "B", range: "75-89", color: "text-[#3b82f6]" },
              { grade: "C", range: "50-74", color: "text-[#eab308]" },
              { grade: "D", range: "25-49", color: "text-[#f97316]" },
              { grade: "F", range: "0-24", color: "text-[#ef4444]" },
            ].map((g) => (
              <div key={g.grade} className="border border-border/50 rounded-lg p-2">
                <div className={`text-lg font-bold ${g.color}`}>{g.grade}</div>
                <div className="text-muted text-xs">{g.range}</div>
              </div>
            ))}
          </div>
        </section>

        {/* MCP */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Bot size={22} />
            MCP Server
          </h2>
          <p className="text-muted">
            For AI agents that support{" "}
            <a
              href="https://modelcontextprotocol.io"
              target="_blank"
              rel="noopener noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              Model Context Protocol
            </a>
            {" "} - structured tool calls over stdio instead of parsing CLI output.
          </p>
          <CodeBlock code="am-i-exposed mcp" />
          <p className="text-muted text-sm">
            Claude Desktop configuration:
          </p>
          <CodeBlock lang="json" code={MCP_CONFIG} />
          <p className="text-muted text-sm">
            Exposes the same 5 tools with typed input schemas (zod validation).
            Compatible with Claude Desktop, Claude Code, Cline, and other MCP clients.
          </p>
        </section>

        {/* Workflows */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Zap size={22} />
            Agent Workflows
          </h2>
          <div className="space-y-4">
            {WORKFLOWS.map((wf) => (
              <div
                key={wf.title}
                className="border border-border/50 rounded-lg p-4 space-y-3"
              >
                <h3 className="font-semibold text-foreground">{wf.title}</h3>
                <ol className="list-decimal list-inside space-y-1.5 text-muted text-sm">
                  {wf.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>

        {/* Performance */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Cpu size={22} />
            Performance
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left text-muted">
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                <tr className="border-b border-border/30">
                  <td className="py-2 pr-4 text-foreground">Normal scan</td>
                  <td className="py-2 pr-4">~10s</td>
                  <td className="py-2">Full context (parent txs + output addresses)</td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="py-2 pr-4 text-foreground">--fast</td>
                  <td className="py-2 pr-4">~6s</td>
                  <td className="py-2">Skip context fetching, all heuristics still run</td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="py-2 pr-4 text-foreground">Cached (repeat)</td>
                  <td className="py-2 pr-4 text-[#28d065]">~1.5s</td>
                  <td className="py-2">SQLite cache, instant on second scan</td>
                </tr>
                <tr className="border-b border-border/30">
                  <td className="py-2 pr-4 text-foreground">PSBT (offline)</td>
                  <td className="py-2 pr-4 text-[#28d065]">&lt;1s</td>
                  <td className="py-2">Zero network access needed</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-foreground">Boltzmann</td>
                  <td className="py-2 pr-4">2-15ms</td>
                  <td className="py-2">Rust/WASM, turbo modes for WabiSabi/JoinMarket</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* Privacy */}
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Shield size={22} />
            Privacy
          </h2>
          <ul className="list-disc list-inside space-y-1.5 text-muted text-sm">
            <li>No addresses or transactions are logged or persisted by the CLI</li>
            <li>Entity detection uses bundled data files (~92 MB), no external APIs</li>
            <li>PSBT analysis requires zero network access</li>
            <li>Only mempool.space API is used for blockchain data (or your custom endpoint)</li>
            <li>All analysis runs locally on your machine</li>
            <li>Self-host with <code className="text-foreground">--api</code> flag pointed at your own mempool instance</li>
          </ul>
        </section>

        {/* Links */}
        <section className="border-t border-border/50 pt-6 flex flex-wrap gap-4 text-sm">
          <a
            href="https://github.com/Copexit/am-i-exposed/blob/main/cli/skill.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-foreground underline underline-offset-2"
          >
            skill.md (full docs)
          </a>
          <a
            href="https://github.com/Copexit/am-i-exposed/tree/main/cli"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-foreground underline underline-offset-2"
          >
            CLI source code
          </a>
          <a
            href="https://github.com/Copexit/am-i-exposed/blob/main/docs/spec-cli-tool.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-foreground underline underline-offset-2"
          >
            Full spec
          </a>
          <a
            href="https://www.npmjs.com/package/am-i-exposed"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted hover:text-foreground underline underline-offset-2"
          >
            npm package
          </a>
        </section>
      </div>
    </div>
  );
}
