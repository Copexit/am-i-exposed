"use client";

import {
  Terminal,
  Bot,
  Braces,
  Shield,
  Zap,
  FileJson,
  Cpu,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { CopyButton } from "@/components/ui/CopyButton";
import {
  TOOLS,
  WORKFLOWS,
  MCP_CONFIG,
  JSON_EXAMPLE,
  GRADES,
  PERF_ROWS,
  PRIVACY_POINTS,
  FOOTER_LINKS,
} from "@/data/agents";

function CodeBlock({ code, lang = "bash" }: { code: string; lang?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-surface-inset rounded-lg p-4 text-sm overflow-x-auto border border-card-border/50">
        <code className={`language-${lang}`}>{code}</code>
      </pre>
      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

export function AgentsPage() {
  return (
    <PageShell
      backLabel="Back to scanner"
      className="sm:px-6 lg:px-8 xl:px-10"
    >
        {/* Title */}
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Bot size={32} className="text-severity-good" />
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
              <div key={tool.name} className="border border-card-border/50 rounded-lg p-4 space-y-2">
                <h3 className="font-mono text-sm font-semibold text-severity-good">{tool.name}</h3>
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
          <CodeBlock lang="json" code={JSON_EXAMPLE} />
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center text-sm">
            {GRADES.map((g) => (
              <div key={g.grade} className="border border-card-border/50 rounded-lg p-2">
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
            <a href="https://modelcontextprotocol.io" target="_blank" rel="noopener noreferrer" className="text-foreground underline underline-offset-2">
              Model Context Protocol
            </a>
            {" "} - structured tool calls over stdio instead of parsing CLI output.
          </p>
          <CodeBlock code="am-i-exposed mcp" />
          <p className="text-muted text-sm">Claude Desktop configuration:</p>
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
              <div key={wf.title} className="border border-card-border/50 rounded-lg p-4 space-y-3">
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
                <tr className="border-b border-card-border/50 text-left text-muted">
                  <th className="py-2 pr-4">Mode</th>
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody className="text-muted">
                {PERF_ROWS.map((row, i) => (
                  <tr key={row.mode} className={i < PERF_ROWS.length - 1 ? "border-b border-card-border/30" : ""}>
                    <td className="py-2 pr-4 text-foreground">{row.mode}</td>
                    <td className={`py-2 pr-4 ${row.timeColor ?? ""}`}>{row.time}</td>
                    <td className="py-2">{row.notes}</td>
                  </tr>
                ))}
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
            {PRIVACY_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
            <li>Self-host with <code className="text-foreground">--api</code> flag pointed at your own mempool instance</li>
          </ul>
        </section>

        {/* Links */}
        <section className="border-t border-card-border/50 pt-6 flex flex-wrap gap-4 text-sm">
          {FOOTER_LINKS.map((link) => (
            <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-foreground underline underline-offset-2">
              {link.label}
            </a>
          ))}
        </section>
    </PageShell>
  );
}
