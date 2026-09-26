"use client";

import { X, Save, FolderOpen, Link2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { truncateId } from "@/lib/constants";
import type { SavedGraph } from "@/lib/graph/saved-graph-types";
import type { BitcoinNetwork } from "@/lib/bitcoin/networks";

type Panel = "save" | "load" | null;

const btnBase = "text-xs transition-colors px-2 py-1 rounded border cursor-pointer";
const btnOff = `${btnBase} text-muted hover:text-foreground border-card-border`;
const btnDisabled = `${btnBase} text-muted/50 border-card-border cursor-not-allowed`;

interface SaveGraphPanelProps {
  activePanel: Panel;
  setActivePanel: (panel: Panel) => void;
  saveName: string;
  setSaveName: (name: string) => void;
  handleSave: () => void;
  handleUpdate: () => void;
  handleShare: () => void;
  graphs: SavedGraph[];
  deleteGraph: (id: string) => void;
  confirmDeleteId: string | null;
  setConfirmDeleteId: (id: string | null) => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
  timeAgo: (ms: number) => string;
  isEmpty: boolean;
  currentGraphId?: string | null;
  network?: BitcoinNetwork;
  onLoadSavedGraph?: (graph: SavedGraph) => void;
  rootTxid?: string;
  currentLabel?: string | null;
}

export function SaveGraphPanel({
  activePanel, setActivePanel,
  saveName, setSaveName,
  handleSave, handleUpdate, handleShare,
  graphs, deleteGraph,
  confirmDeleteId, setConfirmDeleteId,
  panelRef, timeAgo,
  isEmpty, currentGraphId, network, onLoadSavedGraph,
  rootTxid, currentLabel,
}: SaveGraphPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      <div className="ml-auto" />
      <div ref={panelRef} className="relative flex items-center gap-1.5">
        <button
          onClick={() => {
            setActivePanel(activePanel === "save" ? null : "save");
            setSaveName(currentLabel || (rootTxid ? `Graph - ${truncateId(rootTxid)}` : ""));
          }}
          disabled={isEmpty}
          className={isEmpty ? btnDisabled : btnOff}
          title={t("graph.save", { defaultValue: "Save graph (S)" })}
        >
          <span className="flex items-center gap-1">
            <Save size={14} />
            <span className="hidden sm:inline">{t("graph.saveLabel", { defaultValue: "Save" })}</span>
          </span>
        </button>

        {onLoadSavedGraph && (
          <button
            onClick={() => { setActivePanel(activePanel === "load" ? null : "load"); setConfirmDeleteId(null); }}
            className={btnOff}
            title={t("graph.open", { defaultValue: "Open saved graph (O)" })}
          >
            <span className="flex items-center gap-1">
              <FolderOpen size={14} />
              <span className="hidden sm:inline">{t("graph.openLabel", { defaultValue: "Open" })}</span>
            </span>
          </button>
        )}

        <button
          onClick={handleShare}
          disabled={isEmpty}
          className={isEmpty ? btnDisabled : btnOff}
          title={t("graph.share", { defaultValue: "Copy share link (C)" })}
        >
          <span className="flex items-center gap-1">
            <Link2 size={14} />
            <span className="hidden sm:inline">{t("graph.shareLabel", { defaultValue: "Share" })}</span>
          </span>
        </button>

        {/* Save panel */}
        {activePanel === "save" && (
          <div className="absolute top-full right-0 mt-2 z-30 glass rounded-xl border border-glass-border p-3 w-72">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-foreground">{t("graph.saveGraph", { defaultValue: "Save Graph" })}</span>
              <button onClick={() => setActivePanel(null)} className="text-muted hover:text-foreground cursor-pointer"><X size={12} /></button>
            </div>
            <input
              type="text"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder={t("graph.graphName", { defaultValue: "Graph name..." })}
              className="w-full bg-surface-inset text-sm text-foreground placeholder:text-muted/60 rounded-lg px-2.5 py-1.5 outline-none border border-card-border mb-2"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setActivePanel(null); }}
            />
            <div className="flex gap-2">
              <button onClick={handleSave} className="flex-1 text-xs bg-bitcoin/20 text-bitcoin hover:bg-bitcoin/30 rounded-lg px-3 py-1.5 transition-colors cursor-pointer">
                {t("graph.saveLabel", { defaultValue: "Save" })}
              </button>
              {currentGraphId && (
                <button onClick={handleUpdate} className="flex-1 text-xs bg-surface-inset text-muted hover:text-foreground rounded-lg px-3 py-1.5 transition-colors cursor-pointer border border-card-border">
                  {t("graph.update", { defaultValue: "Update" })}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Load panel */}
        {activePanel === "load" && onLoadSavedGraph && (
          <div className="absolute top-full right-0 mt-2 z-30 glass rounded-xl border border-glass-border w-80 max-h-80 overflow-y-auto">
            <div className="sticky top-0 glass border-b border-glass-border px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">{t("graph.savedGraphs", { defaultValue: "Saved Graphs" })}</span>
              <button onClick={() => setActivePanel(null)} className="text-muted hover:text-foreground cursor-pointer"><X size={12} /></button>
            </div>
            {graphs.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-muted">{t("graph.noSavedGraphs", { defaultValue: "No saved graphs yet" })}</div>
            ) : (
              <div className="py-1">
                {graphs.map((g) => (
                  <div key={g.id} className="px-3 py-2 hover:bg-surface-inset flex items-center gap-2 group">
                    <button
                      onClick={() => { onLoadSavedGraph(g); setActivePanel(null); }}
                      className="flex-1 text-left min-w-0 cursor-pointer"
                    >
                      <div className="text-sm text-foreground truncate">{g.name}</div>
                      <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                        <span>{g.nodes.length} nodes</span>
                        {g.network !== network && (
                          <span className="px-1 rounded bg-severity-medium/20 text-severity-medium">{g.network}</span>
                        )}
                        <span>{timeAgo(g.savedAt)}</span>
                      </div>
                    </button>
                    {confirmDeleteId === g.id ? (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => { deleteGraph(g.id); setConfirmDeleteId(null); }} className="text-[10px] text-severity-critical hover:underline cursor-pointer">Delete</button>
                        <button onClick={() => setConfirmDeleteId(null)} className="text-[10px] text-muted hover:underline cursor-pointer">Cancel</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteId(g.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted hover:text-severity-critical transition-all cursor-pointer shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
