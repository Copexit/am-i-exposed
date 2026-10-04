"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileUp } from "lucide-react";
import { readInputFile, InputFileError } from "@/lib/input/file";

function useFileReader(onPayload: (text: string) => void, onError: (m: string) => void) {
  const { t } = useTranslation();
  return useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      onPayload(await readInputFile(file));
    } catch (err) {
      onError(err instanceof InputFileError && err.reason === "too-large"
        ? t("input.errorFileTooLarge", { defaultValue: "That file is larger than 4 MB." })
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

/** Icon buttons inside the search fields: open a file (and, from Task 19, scan a QR). */
export function InputExtras({ onPayload, onError }: { onPayload: (text: string) => void; onError: (m: string) => void; compact?: boolean }) {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const read = useFileReader(onPayload, onError);
  const label = t("input.openFile", { defaultValue: "Open a PSBT or transaction file" });
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-testid="open-file"
        onClick={() => fileRef.current?.click()}
        className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-muted hover:text-foreground transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-bitcoin focus-visible:outline-none"
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
    </div>
  );
}
