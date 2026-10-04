"use client";

import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp, ScanLine } from "lucide-react";
import { readInputFile, InputFileError } from "@/lib/input/file";

const QrScanner = lazy(() => import("./QrScanner").then((m) => ({ default: m.QrScanner })));

const ICON_BUTTON = "inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-muted hover:text-foreground transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-bitcoin focus-visible:outline-none";

function useFileReader(onPayload: (text: string) => void, onError: (m: string) => void) {
  const { t } = useTranslation();
  return useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      onPayload(await readInputFile(file));
    } catch (err) {
      onError(err instanceof InputFileError && err.reason === "too-large"
        ? t("input.errorFileTooLarge", { defaultValue: "That file is larger than 2 MB." })
        : t("input.errorFileUnreadable", { defaultValue: "That file could not be read." }));
    }
  }, [onPayload, onError, t]);
}

/** Drag-and-drop on any wrapper element. */
export function useFileDrop(onPayload: (text: string) => void, onError: (m: string) => void) {
  const read = useFileReader(onPayload, onError);
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setDragging(false);
      void read(e.dataTransfer.files[0]);
    },
  };
}

/** Icon buttons inside the search fields: open a file, scan a QR. Both feed the field's paste path. */
export function InputExtras({ onPayload, onError }: { onPayload: (text: string) => void; onError: (m: string) => void }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const read = useFileReader(onPayload, onError);
  const [scanning, setScanning] = useState(false);
  const label = t("input.openFile", { defaultValue: "Open a PSBT or transaction file" });
  const scanLabel = t("qr.open", { defaultValue: "Scan a QR code" });
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-testid="open-file"
        onClick={() => fileRef.current?.click()}
        className={ICON_BUTTON}
        aria-label={label}
        title={label}
      >
        <FileUp size={18} aria-hidden="true" />
      </button>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ""; }}
      />
      <button
        type="button"
        data-testid="scan-qr"
        onClick={() => setScanning(true)}
        className={ICON_BUTTON}
        aria-label={scanLabel}
        title={scanLabel}
      >
        <ScanLine size={18} aria-hidden="true" />
      </button>
      {scanning && (
        <Suspense fallback={null}>
          <QrScanner onResult={onPayload} onClose={() => setScanning(false)} />
        </Suspense>
      )}
    </div>
  );
}
