"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Camera, RefreshCw, SwitchCamera, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { QrAssembler, type AssemblerState } from "@/lib/input/qr-assembler";
import { hasFinePointerOnly, shouldMirrorPreview } from "@/lib/input/camera-mirror";
import { createFrameDecoder, decodeImageFile } from "@/lib/input/qr-decode";

const FRAME_MS = 120;

type Message = "denied" | "noCamera" | "decoderFailed" | "photoNoCode";

function cameraAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia;
}

/** Camera modal that reads static, BC-UR and BBQr QR codes. Frame contents are never logged. */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const assembler = useRef(new QrAssembler());
  const stopRef = useRef<() => void>(() => {});
  const doneRef = useRef(false);
  const liveRef = useRef(false); // camera loop running
  const pausedRef = useRef(false); // stopped because the page was hidden
  const currentDevice = useRef<string | undefined>(undefined);

  const [secure] = useState(cameraAvailable);
  const [cameraOff, setCameraOff] = useState(!secure);
  const [message, setMessage] = useState<Message | null>(null);
  const [progress, setProgress] = useState<AssemblerState>({ kind: "idle" });
  const [devices, setDevices] = useState<string[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [run, setRun] = useState(0);
  const [mirror, setMirror] = useState(false); // CSS-only: decoding reads raw frames from the <video>

  // Latest callbacks in a ref so a parent re-render never restarts the camera.
  const cb = useRef({ onResult, onClose });
  useEffect(() => { cb.current = { onResult, onClose }; });

  const close = useCallback(() => { stopRef.current(); cb.current.onClose(); }, []);

  /** Shared by camera frames and photos. Returns true when scanning should stop. */
  const handle = useCallback((s: AssemblerState): boolean => {
    if (s.kind === "done") {
      if (doneRef.current) return true;
      doneRef.current = true;
      stopRef.current();
      cb.current.onResult(s.payload);
      cb.current.onClose();
      return true;
    }
    setProgress(s);
    if (s.kind === "error") { stopRef.current(); return true; }
    return false;
  }, []);

  useFocusTrap(dialogRef, true);
  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    // Hidden page: release the camera but keep the modal (the photo picker hides the page on
    // Android). Visible again: restart the camera if it was paused; assembled parts are kept.
    const pause = () => {
      if (!liveRef.current) return;
      stopRef.current();
      pausedRef.current = true;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pause();
      else if (pausedRef.current) { pausedRef.current = false; setRun((n) => n + 1); }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", pause);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pause);
    };
  }, [close]);

  // Camera + decode loop. Restarts on camera switch, "Scan again" and return from a hidden page.
  useEffect(() => {
    if (!secure) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let decoder: Awaited<ReturnType<typeof createFrameDecoder>> | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    let busy = false;
    const stop = () => {
      stopped = true;
      liveRef.current = false;
      clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
      decoder?.close();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
    const fail = () => {
      stop();
      setCameraOff(true);
      setMessage("decoderFailed");
    };
    stopRef.current = stop;

    void (async () => {
      if (typeof createImageBitmap !== "function") { fail(); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia(
          deviceId ? { video: { deviceId: { exact: deviceId } } } : { video: { facingMode: "environment" } },
        );
      } catch (err) {
        if (stopped) return;
        setCameraOff(true);
        setMessage(err instanceof DOMException && err.name === "NotAllowedError" ? "denied" : "noCamera");
        return;
      }
      if (stopped) { stream.getTracks().forEach((tr) => tr.stop()); return; }
      liveRef.current = true;
      const track = stream.getVideoTracks()[0];
      const settings = track?.getSettings();
      currentDevice.current = settings?.deviceId;
      setMirror(shouldMirrorPreview({ facingMode: settings?.facingMode, label: track?.label, finePointer: hasFinePointerOnly() }));
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play()?.catch(() => {});
      }
      navigator.mediaDevices.enumerateDevices?.()
        .then((list) => { if (!stopped) setDevices(list.filter((d) => d.kind === "videoinput").map((d) => d.deviceId)); })
        .catch(() => {});
      let dec: Awaited<ReturnType<typeof createFrameDecoder>>;
      try {
        dec = await createFrameDecoder();
      } catch {
        if (!stopped) fail();
        return;
      }
      if (stopped) { dec.close(); return; }
      decoder = dec;
      const tick = async () => {
        const v = videoRef.current;
        if (busy || stopped || !v || v.readyState < 2 || !v.videoWidth) return;
        busy = true;
        try {
          const bitmap = await createImageBitmap(v);
          const text = await dec.decode(bitmap).finally(() => bitmap.close());
          if (stopped) return;
          if (text === null) {
            if (dec.failed) fail();
            return;
          }
          const s = await assembler.current.push(text);
          if (!stopped) handle(s);
        } catch {
          // Video not ready yet, or a transient decode failure: try the next frame.
        } finally {
          busy = false;
        }
      };
      timer = setInterval(() => void tick(), FRAME_MS);
    })();
    return stop;
  }, [secure, deviceId, run, handle]);

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    let text: string | null = null;
    try { text = await decodeImageFile(file); } catch { /* unreadable image */ }
    if (text === null) {
      setMessage("photoNoCode");
      return;
    }
    handle(await assembler.current.push(text));
  };

  const scanAgain = () => {
    assembler.current.reset();
    doneRef.current = false;
    setProgress({ kind: "idle" });
    setMessage(null);
    if (!cameraOff) setRun((n) => n + 1);
  };

  const switchCamera = () => {
    const i = devices.indexOf(deviceId ?? currentDevice.current ?? "");
    setDeviceId(devices[(i + 1) % devices.length]);
  };

  const messageText: Record<Message, string> = {
    denied: t("qr.denied", { defaultValue: "Camera access was blocked. Allow it in the browser settings, or take a photo of the QR." }),
    noCamera: t("qr.noCamera", { defaultValue: "No camera found. Take a photo of the QR, or paste it." }),
    decoderFailed: t("qr.decoderFailed", { defaultValue: "QR decoder unavailable: take a photo or paste instead." }),
    photoNoCode: t("qr.photoNoCode", { defaultValue: "No QR code found in that photo." }),
  };

  const iconBtn = "inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg text-muted hover:text-foreground transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-bitcoin focus-visible:outline-none";
  const actionBtn = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-lg bg-surface-inset text-sm text-foreground hover:bg-bitcoin/20 transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-bitcoin";

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      // Portal events bubble to the field: keep drops on the modal away from its file-drop handler.
      onDragOver={(e) => e.stopPropagation()}
      onDrop={(e) => e.stopPropagation()}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-scan-title"
        className="relative w-full max-w-md bg-surface-elevated border border-card-border rounded-2xl shadow-2xl outline-none overflow-hidden"
      >
        <div className="flex items-center justify-between pl-5 pr-2 py-1">
          <h2 id="qr-scan-title" className="text-base font-semibold text-foreground">
            {t("qr.title", { defaultValue: "Scan a QR code" })}
          </h2>
          <div className="flex items-center">
            {!cameraOff && devices.length > 1 && (
              <button type="button" onClick={switchCamera} className={iconBtn} aria-label={t("qr.switchCamera", { defaultValue: "Switch camera" })}>
                <SwitchCamera size={18} aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={close} className={iconBtn} aria-label={t("common.close", { defaultValue: "Close" })}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </div>

        {!cameraOff && (
          <video ref={videoRef} playsInline muted autoPlay className={`w-full aspect-square object-cover bg-black${mirror ? " -scale-x-100" : ""}`} />
        )}

        <div className="p-5 space-y-3 text-sm" aria-live="polite">
          {progress.kind === "progress" && (
            <div className="space-y-1.5">
              <p className="text-foreground">
                {progress.format === "bbqr"
                  ? t("qr.progressParts", { received: progress.received, total: progress.total, defaultValue: "{{received}} of {{total}} parts" })
                  : t("qr.progressPercent", { percent: progress.percent, defaultValue: "{{percent}}% received" })}
              </p>
              <div className="h-1 rounded-full bg-surface-inset overflow-hidden">
                <div className="h-full bg-bitcoin transition-[width]" style={{ width: `${progress.percent}%` }} />
              </div>
            </div>
          )}
          {progress.kind === "error" && (
            <p className="text-severity-high">
              {progress.reason === "multisig"
                ? t("qr.multisig", { defaultValue: "Multisig wallet exports are not supported yet." })
                : t("qr.unsupported", { defaultValue: "This QR type is not supported." })}
            </p>
          )}
          {cameraOff && !secure && (
            <p className="text-muted">
              {t("qr.insecure", { defaultValue: "The camera needs HTTPS, localhost or the .onion address. You can take a photo of a static QR instead; animated QRs need the camera." })}
            </p>
          )}
          {message && <p className="text-muted">{messageText[message]}</p>}

          <div className="flex flex-wrap gap-2">
            {progress.kind === "error" && (
              <button type="button" onClick={scanAgain} className={actionBtn}>
                <RefreshCw size={16} aria-hidden="true" />
                {t("qr.scanAgain", { defaultValue: "Scan again" })}
              </button>
            )}
            {cameraOff && (
              <label className={actionBtn}>
                <Camera size={16} aria-hidden="true" />
                {t("qr.photo", { defaultValue: "Take a photo of the QR" })}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
            )}
          </div>
        </div>
      </div>
    </motion.div>,
    document.body,
  );
}
