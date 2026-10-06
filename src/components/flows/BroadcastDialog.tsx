"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Loader2, Send, ShieldAlert, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { formatSats } from "@/lib/format";
import { findingKeys } from "@/lib/finding-utils";
import { compareFindings } from "@/lib/view/findings";
import { broadcastTx, getTxStatus, testMempoolAccept, type BroadcastReason } from "@/lib/api/broadcast";
import { endpointHost, isOnionUrl, type BackendClass } from "@/lib/api/backend-class";
import type { LocalTx } from "@/lib/input/local-tx";
import type { MempoolTransaction } from "@/lib/api/types";
import type { ScoringResult } from "@/lib/types";

interface BroadcastDialogProps {
  local: LocalTx;
  tx: MempoolTransaction;
  result: ScoringResult;
  baseUrl: string;
  cls: BackendClass;
  onClose: () => void;
  onSuccess: (txid: string) => void;
  /** A previous attempt ended "unknown": reopen on Check status, never a fresh confirm. */
  unknownSent?: boolean;
  /** Reports the "unknown" state so it survives the dialog closing. */
  onUnknownChange?: (unknown: boolean) => void;
}

type Phase = "idle" | "sending" | "rejected" | "unknown" | "mismatch" | "confirmed";

/** How long the txid mismatch note stays up before the scan takes over. */
export const MISMATCH_NOTE_MS = 2000;

const REASON_EN: Record<BroadcastReason, string> = {
  "inputs-missing-or-spent": "One or more inputs are missing or already spent: wrong network, or the coins were already spent by this or another transaction.",
  policy: "The node rejected it by policy: fee too low, not final yet, or it conflicts with a transaction in the mempool.",
  other: "The node rejected the transaction.",
};

/** Confirm step before a signed local tx is sent. One POST per confirm, never retried. */
export function BroadcastDialog({ local, tx, result, baseUrl, cls, onClose, onSuccess, unknownSent = false, onUnknownChange }: BroadcastDialogProps) {
  const { t, i18n } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>(unknownSent ? "unknown" : "idle");
  const sendingRef = useRef(false); // synchronous guard: React state updates are async
  const [rejection, setRejection] = useState<{ message: string; reason: BroadcastReason } | null>(null);
  const [dryRun, setDryRun] = useState<{ allowed: boolean; reason?: string } | null>(null);
  const [status, setStatus] = useState<"checking" | "not-found" | "error" | null>(null);

  const host = endpointHost(baseUrl);
  const endpointPath = `${baseUrl.replace(/\/+$/, "")}/tx`;
  // A relative base (Umbrel "/api") is shown as the absolute URL it resolves to.
  const endpointUrl = endpointPath.startsWith("/") ? new URL(endpointPath, window.location.origin).href : endpointPath;
  const onion = isOnionUrl(baseUrl);
  const worst = result.findings.filter((f) => f.scoreImpact < 0).sort(compareFindings)[0];
  const critical = worst?.severity === "critical";
  const known = tx.vin.every((v) => v.prevout);
  const vsize = Math.ceil(tx.weight / 4);

  useFocusTrap(dialogRef, true);
  useEffect(() => { dialogRef.current?.focus(); }, []);

  useEffect(() => {
    if (cls !== "self-hosted" || !local.signedHex) return;
    let live = true;
    void testMempoolAccept(baseUrl, local.signedHex).then((r) => { if (live && r) setDryRun(r); });
    return () => { live = false; };
  }, [cls, baseUrl, local.signedHex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !sendingRef.current) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const confirm = useCallback(async () => {
    if (sendingRef.current || !local.signedHex) return;
    sendingRef.current = true;
    setPhase("sending");
    setStatus(null);
    // Focus inside the dialog so global keys (Backspace = back) cannot act mid-send.
    dialogRef.current?.focus();
    const out = await broadcastTx(baseUrl, local.signedHex, tx.txid);
    // On a txid mismatch the node's txid is the one to scan; say so briefly first.
    if (out.kind === "sent" && out.mismatch) {
      setPhase("mismatch");
      setTimeout(() => onSuccess(out.txid), MISMATCH_NOTE_MS);
      return;
    }
    if (out.kind === "sent") { onSuccess(out.txid); return; }
    sendingRef.current = false;
    // Nothing was broadcast: say so instead of silently opening the tx.
    if (out.kind === "already-confirmed") { setPhase("confirmed"); return; }
    if (out.kind === "unknown") { setPhase("unknown"); onUnknownChange?.(true); return; }
    setRejection({ message: out.message, reason: out.reason });
    setPhase("rejected");
  }, [baseUrl, local.signedHex, tx.txid, onSuccess, onUnknownChange]);

  const checkStatus = useCallback(async () => {
    setStatus("checking");
    const s = await getTxStatus(baseUrl, tx.txid);
    if (s === "mempool" || s === "confirmed") { onSuccess(tx.txid); return; }
    setStatus(s);
    if (s === "not-found") { setPhase("idle"); onUnknownChange?.(false); }
  }, [baseUrl, tx.txid, onSuccess, onUnknownChange]);

  const sending = phase === "sending" || phase === "mismatch";
  const name = cls === "self-hosted"
    ? t("broadcast.nameNode", { host, defaultValue: "your node ({{host}})" })
    : onion
      ? t("broadcast.nameOnion", { defaultValue: "mempool.space over Tor" })
      : t("broadcast.nameMempool", { defaultValue: "mempool.space" });
  const privacy = cls === "self-hosted"
    ? t("broadcast.privacyNode", { defaultValue: "Your own node relays it to its peers." })
    : onion
      ? t("broadcast.privacyOnion", { defaultValue: "Sent over Tor: your IP address is hidden, but mempool.space still sees the transaction first." })
      : t("broadcast.privacyClearnet", { defaultValue: "mempool.space will see your IP address together with this transaction. It is the first place your transaction is seen." });

  return createPortal(
    <motion.div
      data-testid="broadcast-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !sendingRef.current) onClose(); }}
    >
      <motion.div
        ref={dialogRef}
        tabIndex={-1}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="broadcast-title"
        aria-busy={sending}
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-surface-elevated border border-bitcoin/30 rounded-2xl shadow-2xl outline-none"
      >
        {!sending && (
          <button
            type="button"
            data-testid="broadcast-close"
            onClick={onClose}
            className="absolute top-4 right-4 text-muted hover:text-foreground transition-colors cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X size={18} />
          </button>
        )}

        <div className="p-6 sm:p-8 space-y-5 text-sm">
          <div className="flex items-center gap-3 pr-6">
            <div className="p-2 rounded-full bg-bitcoin/10">
              <Send size={20} className="text-bitcoin" aria-hidden="true" />
            </div>
            <h2 id="broadcast-title" className="text-lg font-semibold text-foreground">
              {t("broadcast.title", { defaultValue: "Broadcast transaction" })}
            </h2>
          </div>

          <div className="bg-surface-inset rounded-lg px-4 py-3 space-y-1.5">
            <ul className="space-y-1">
              {tx.vout.map((o, i) => (
                <li key={i} className="flex justify-between gap-3 min-w-0">
                  <span className="font-mono text-xs text-foreground truncate">{o.scriptpubkey_type === "op_return" ? "OP_RETURN" : (o.scriptpubkey_address ?? o.scriptpubkey_type)}</span>
                  <span className="num text-xs text-foreground shrink-0">{formatSats(o.value, i18n.language)}</span>
                </li>
              ))}
            </ul>
            {!known ? (
              <p data-testid="broadcast-fee" className="text-xs font-medium text-severity-medium">
                {t("broadcast.feeUnknown", { defaultValue: "Fee: unknown (input amounts not looked up)" })}
              </p>
            ) : tx.fee > 0 ? (
              <p data-testid="broadcast-fee" className="text-xs text-muted num">
                {t("psbt.fee", { defaultValue: "Fee" })}: {formatSats(tx.fee, i18n.language)}{vsize > 0 && ` (${Math.round(tx.fee / vsize)} sat/vB)`}
              </p>
            ) : (
              <p data-testid="broadcast-fee" className="text-xs font-medium text-severity-critical num">
                {t("broadcast.feeZero", { fee: formatSats(tx.fee, i18n.language), defaultValue: "Fee: {{fee}} - nodes will reject this transaction" })}
              </p>
            )}
            <p className="text-xs text-muted">{t("broadcast.projectedGrade", { grade: result.grade, defaultValue: "Projected grade: {{grade}}" })}</p>
          </div>

          <div className="space-y-2">
            <p className="text-foreground break-words">{t("broadcast.endpoint", { name, url: endpointUrl, defaultValue: "Sends the signed transaction to {{name}} ({{url}})" })}</p>
            <p className="text-muted">{privacy}</p>
          </div>

          {critical && worst && (
            <div className="flex items-start gap-2.5 rounded-lg border border-severity-critical/40 bg-severity-critical/10 px-3.5 py-3">
              <ShieldAlert size={16} className="shrink-0 mt-0.5 text-severity-critical" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-medium text-foreground break-words">{t(findingKeys(worst.id, "title", worst.params), { ...worst.params, defaultValue: worst.title })}</p>
                <p className="text-severity-critical">{t("broadcast.criticalNote", { defaultValue: "This transaction has a critical privacy leak." })}</p>
              </div>
            </div>
          )}

          {dryRun && (
            <p className={dryRun.allowed ? "text-severity-good" : "text-severity-critical"}>
              {dryRun.allowed
                ? t("broadcast.dryRunOk", { defaultValue: "Your node would accept this transaction." })
                : t("broadcast.dryRunRejected", { reason: dryRun.reason, defaultValue: "Your node would reject it: {{reason}}" })}
            </p>
          )}

          {phase === "rejected" && rejection && (
            <div role="alert" className="space-y-1.5">
              <p className="font-mono text-xs text-severity-critical break-words">{rejection.message}</p>
              <p className="text-foreground">{t(`broadcast.reason.${rejection.reason}`, { defaultValue: REASON_EN[rejection.reason] })}</p>
            </div>
          )}

          {phase === "mismatch" && (
            <p role="status" className="text-severity-medium">{t("broadcast.txidMismatch", { defaultValue: "The node returned a different txid than the one computed here. Opening the node's txid." })}</p>
          )}

          {phase === "confirmed" && (
            <p role="status" data-testid="broadcast-already-confirmed" className="text-foreground">
              {t("broadcast.alreadyConfirmed", { defaultValue: "This transaction is already in the blockchain. Nothing new was broadcast." })}
            </p>
          )}

          {phase === "unknown" && (
            <div role="alert" className="space-y-1.5">
              <p className="text-severity-medium">{t("broadcast.unknown", { defaultValue: "It is unknown whether the transaction was sent. Check its status before trying again." })}</p>
              {cls === "self-hosted" && !baseUrl.startsWith("/") && (
                <p className="text-muted">{t("broadcast.corsHint", { defaultValue: "If you use your own mempool instance, it may block broadcasts from the browser. Broadcast from your wallet or node instead." })}</p>
              )}
            </div>
          )}
          {status === "not-found" && <p className="text-muted">{t("broadcast.statusNotFound", { host, defaultValue: "Not found on {{host}}. It was probably not sent." })}</p>}
          {status === "error" && <p className="text-severity-medium">{t("broadcast.statusError", { defaultValue: "Could not check. Try again in a moment." })}</p>}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-1">
            {(phase === "idle" || phase === "rejected" || sending) && (
              <button
                type="button"
                data-testid="broadcast-confirm"
                onClick={() => { void confirm(); }}
                disabled={sending}
                className={`inline-flex items-center justify-center gap-1.5 px-4 py-2 font-semibold text-sm rounded-lg transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default ${critical ? "bg-severity-critical/90 hover:bg-severity-critical text-white" : "bg-bitcoin/90 hover:bg-bitcoin text-black"}`}
              >
                {sending && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                {sending
                  ? t("broadcast.sending", { defaultValue: "Broadcasting..." })
                  : critical ? t("broadcast.anyway", { defaultValue: "Broadcast anyway" }) : t("broadcast.confirm", { defaultValue: "Broadcast" })}
              </button>
            )}
            {phase === "unknown" && (
              <button
                type="button"
                data-testid="broadcast-check-status"
                onClick={() => { void checkStatus(); }}
                disabled={status === "checking"}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 font-semibold text-sm rounded-lg bg-bitcoin/10 text-bitcoin hover:bg-bitcoin/20 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
              >
                {status === "checking" && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
                {t("broadcast.checkStatus", { defaultValue: "Check status" })}
              </button>
            )}
            {phase === "confirmed" && (
              <button
                type="button"
                data-testid="broadcast-open-confirmed"
                onClick={() => onSuccess(tx.txid)}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 font-semibold text-sm rounded-lg bg-bitcoin/90 hover:bg-bitcoin text-black transition-colors cursor-pointer"
              >
                {t("broadcast.openConfirmed", { defaultValue: "Open the transaction" })}
              </button>
            )}
            {!sending && (
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted hover:text-foreground transition-colors cursor-pointer">
                {phase === "confirmed" ? t("common.close", { defaultValue: "Close" }) : t("broadcast.cancel", { defaultValue: "Cancel" })}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
