"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Terminal, Loader2, ShieldCheck, ShieldX, ShieldAlert } from "lucide-react";
import {
  checkChainalysisViaTor,
  type ChainalysisRoutingResult,
} from "@/lib/analysis/cex-risk/chainalysis-check";

const DEFAULT_ADDRESS = "12QtD5BFwRsdNsAZY76UVE1xyCGNTojH9h";

type TestStatus = "idle" | "loading" | "done" | "error";

export function DevChainalysisPanel() {
  const [address, setAddress] = useState(DEFAULT_ADDRESS);
  const [status, setStatus] = useState<TestStatus>("idle");
  const [result, setResult] = useState<ChainalysisRoutingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const runTest = useCallback(async () => {
    const trimmed = address.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus("loading");
    setResult(null);
    setError(null);
    setLatencyMs(null);

    const start = performance.now();

    try {
      const res = await checkChainalysisViaTor([trimmed], controller.signal);
      if (controller.signal.aborted) return;
      setLatencyMs(Math.round(performance.now() - start));
      setResult(res);
      setStatus("done");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setLatencyMs(Math.round(performance.now() - start));
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  }, [address]);

  return (
    <div className="w-full max-w-2xl">
      <div className="rounded-xl border border-severity-medium/30 bg-severity-medium/5 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Terminal size={14} className="text-severity-medium" />
          <span className="text-xs font-semibold text-severity-medium uppercase tracking-wider">
            Tor Proxy Test
          </span>
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Mainnet Bitcoin address"
            className="flex-1 px-3 py-2 text-sm font-mono bg-surface-inset border border-card-border rounded-lg text-foreground placeholder:text-muted/50 focus:border-severity-medium/40 focus-visible:outline-2 focus-visible:outline-severity-medium/50 transition-colors"
          />
          <button
            onClick={runTest}
            disabled={status === "loading" || !address.trim()}
            className="px-4 py-2 text-sm font-medium text-severity-medium bg-severity-medium/10 hover:bg-severity-medium/20 border border-severity-medium/30 rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {status === "loading" ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={14} className="animate-spin" />
                Testing...
              </span>
            ) : (
              "Test Tor Proxy"
            )}
          </button>
        </div>

        {status === "done" && result && (
          <div className="rounded-lg bg-surface-inset p-3 space-y-2">
            <div className="flex items-center gap-2">
              {result.sanctioned ? (
                <ShieldX size={14} className="text-severity-critical" />
              ) : (
                <ShieldCheck size={14} className="text-severity-good" />
              )}
              <span className={`text-sm font-medium ${result.sanctioned ? "text-severity-critical" : "text-severity-good"}`}>
                {result.sanctioned ? "FLAGGED" : "Clear"}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-severity-good/10 text-severity-good">
                via {result.route}
              </span>
              {latencyMs !== null && (
                <span className="text-xs text-muted ml-auto">{latencyMs}ms</span>
              )}
            </div>
            {result.identifications.length > 0 && (
              <div className="space-y-1">
                {result.identifications.map((id, i) => (
                  <div key={i} className="text-xs text-muted">
                    <span className="text-severity-critical font-medium">{id.category}</span>
                    {id.name && <span> - {id.name}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {status === "error" && (
          <div className="rounded-lg bg-surface-inset p-3 flex items-start gap-2">
            <ShieldAlert size={14} className="text-severity-high mt-0.5 shrink-0" />
            <div className="space-y-1">
              <span className="text-sm font-medium text-severity-high">Tor proxy failed</span>
              <p className="text-xs text-muted break-all">{error}</p>
            </div>
            {latencyMs !== null && (
              <span className="text-xs text-muted ml-auto shrink-0">{latencyMs}ms</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
