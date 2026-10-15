"use client";

import { useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Bip329ConflictPreview } from "@/components/labels/Bip329ConflictPreview";
import { fmtN } from "@/lib/format";
import { bip329ToGraphLabels, edgesFromNodes, graphLabelsToBip329, recordFitsGraph } from "@/lib/graph/graph-labels-bip329";
import { downloadBip329, readBip329File } from "@/lib/wallet/bip329-io";
import { applyMerge, mergeBip329, type Bip329Merge } from "@/lib/wallet/bip329-merge";
import type { GraphNode } from "./types";

const BTN = "flex-1 inline-flex items-center justify-center gap-1.5 min-h-9 text-xs rounded-lg px-2 py-1.5 border border-card-border text-muted hover:text-foreground transition-colors cursor-pointer";

/** Export and import of the graph's node and edge labels as BIP329 (inside the Save panel). */
export function GraphLabelsIO({ nodes, rootTxid, nodeLabels, edgeLabels, onSetLabels }: {
  nodes: Map<string, GraphNode>;
  rootTxid: string;
  nodeLabels: Map<string, string>;
  edgeLabels: Map<string, string>;
  onSetLabels: (nodeLabels: Map<string, string>, edgeLabels: Map<string, string>) => void;
}) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ merge: Bip329Merge; unmatched: number } | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const edges = edgesFromNodes(nodes);
  const nodeTxids = new Set(nodes.keys());
  const existing = graphLabelsToBip329(nodeLabels, edgeLabels, edges);

  function commit(merge: Bip329Merge, replace: Set<string>) {
    const mapped = bip329ToGraphLabels(applyMerge(existing, merge, replace), nodeTxids, edges);
    // Labels the export cannot carry (an edge with unknown outputs) stay as they are
    onSetLabels(new Map([...nodeLabels, ...mapped.nodeLabels]), new Map([...edgeLabels, ...mapped.edgeLabels]));
    setStatus(t("labels.graph.imported", { count: merge.added.length + replace.size, n: fmtN(merge.added.length + replace.size), defaultValue: "{{n}} labels imported" }));
    setPending(null);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const parsed = await readBip329File(file);
    if (fileRef.current) fileRef.current.value = "";
    if (!parsed) { setStatus(t("wallet.labels.tooLarge", { size: "5 MB", defaultValue: "The file is larger than {{size}}, too large for a label export." })); return; }
    if (parsed.records.length === 0) { setStatus(t("wallet.labels.none", { defaultValue: "No labels found: the file has no record with a label or a freeze." })); return; }
    const fits = parsed.records.filter((r) => recordFitsGraph(r, nodeTxids, edges));
    const merge = mergeBip329(existing, fits, true);
    const unmatched = parsed.records.length - fits.length;
    if (merge.conflicts.length === 0 && unmatched === 0) commit(merge, new Set());
    else setPending({ merge, unmatched });
  }

  return (
    <div className="mt-3 pt-3 border-t border-hairline space-y-2" data-testid="graph-labels-io">
      <span className="block text-xs font-medium text-foreground">{t("labels.graph.title", { defaultValue: "Labels (BIP329)" })}</span>
      <div className="flex gap-2">
        <button
          type="button"
          className={BTN}
          disabled={existing.length === 0}
          onClick={() => downloadBip329(existing, `graph-labels-${rootTxid.slice(0, 8)}.jsonl`)}
        >
          <Download size={13} aria-hidden="true" />
          {t("labels.graph.export", { defaultValue: "Export labels (BIP329)" })}
        </button>
        <label className={`${BTN} focus-within:ring-2 focus-within:ring-bitcoin/60`}>
          <input
            ref={fileRef}
            type="file"
            accept=".jsonl,.json,.txt,application/jsonl,application/json,text/plain"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <FileUp size={13} aria-hidden="true" />
          {t("labels.graph.import", { defaultValue: "Import labels (BIP329)" })}
        </label>
      </div>
      <p className="text-[11px] text-muted leading-relaxed">{t("labels.plaintext", { defaultValue: "The file is plain text: anyone who gets it can read every label. Keep it private." })}</p>
      <div role="status" aria-live="polite" data-testid="graph-labels-status" className="empty:hidden text-[11px] text-foreground">{status}</div>
      {pending && (
        <Bip329ConflictPreview
          merge={pending.merge}
          unmatched={pending.unmatched}
          onCancel={() => setPending(null)}
          onApply={(keys) => commit(pending.merge, keys)}
        />
      )}
    </div>
  );
}
