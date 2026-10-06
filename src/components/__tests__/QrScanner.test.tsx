// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(opts?.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k])),
  }),
}));

const decoder = { decode: vi.fn<() => Promise<string | null>>(), close: vi.fn(), failed: false };
vi.mock("@/lib/input/qr-decode", () => ({
  createFrameDecoder: vi.fn(async () => decoder),
  decodeImageFile: vi.fn(async () => null),
}));

import { QrScanner } from "../QrScanner";

const ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

function fakeStream(facingMode?: string, deviceId = "cam-1") {
  const stop = vi.fn();
  const track = { stop, label: "", getSettings: () => ({ deviceId, facingMode }) };
  return { stop, stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream };
}

function setCamera(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>, secure = true) {
  Object.defineProperty(window, "isSecureContext", { value: secure, configurable: true });
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn(getUserMedia), enumerateDevices: vi.fn(async () => [{ kind: "videoinput", deviceId: "cam-1" }]) },
    configurable: true,
  });
  return navigator.mediaDevices.getUserMedia as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  decoder.decode.mockReset().mockResolvedValue(null);
  decoder.close.mockReset();
  decoder.failed = false;
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn() })));
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { get: () => 4, configurable: true });
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", { get: () => 640, configurable: true });
});

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  fireEvent(document, new Event("visibilitychange"));
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QrScanner", () => {
  it("without a secure context offers only the photo input and never asks for the camera", () => {
    const gum = setCamera(async () => fakeStream().stream, false);
    const { container } = render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/camera is not available here/)).toBeTruthy();
    expect(container.ownerDocument.querySelector('input[type="file"][accept="image/*"]')).toBeTruthy();
    expect(gum).not.toHaveBeenCalled();
  });

  it("shows the denied message and the photo input when permission is blocked", async () => {
    setCamera(async () => { throw new DOMException("x", "NotAllowedError"); });
    render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/Camera access was blocked/)).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("shows the no-camera message for NotFoundError", async () => {
    setCamera(async () => { throw new DOMException("x", "NotFoundError"); });
    render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/No camera found/)).toBeTruthy();
  });

  it("the close button stops the camera tracks and the decoder", async () => {
    const { stop, stream } = fakeStream();
    const gum = setCamera(async () => stream);
    const onClose = vi.fn();
    render(<QrScanner onResult={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(gum).toHaveBeenCalledWith({ video: { facingMode: "environment" } }));
    await waitFor(() => expect(decoder.decode).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(stop).toHaveBeenCalled();
    expect(decoder.close).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape stops the tracks and closes", async () => {
    const { stop, stream } = fakeStream();
    setCamera(async () => stream);
    const onClose = vi.fn();
    render(<QrScanner onResult={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(decoder.decode).toHaveBeenCalled());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(stop).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("a decoded frame goes through the assembler to onResult, then closes", async () => {
    const { stop, stream } = fakeStream();
    setCamera(async () => stream);
    decoder.decode.mockResolvedValue(ADDRESS);
    const onResult = vi.fn();
    const onClose = vi.fn();
    render(<QrScanner onResult={onResult} onClose={onClose} />);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(ADDRESS));
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    expect(stop).toHaveBeenCalled();
  });

  it("shows BBQr part progress", async () => {
    setCamera(async () => fakeStream().stream);
    decoder.decode.mockResolvedValue("B$HP0300" + "70736274ff");
    render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText("1 of 3 parts")).toBeTruthy();
  });

  it("falls back to photo mode when the decoder cannot load", async () => {
    setCamera(async () => fakeStream().stream);
    decoder.failed = true;
    render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/QR decoder unavailable/)).toBeTruthy();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("falls back to photo mode when the decoder fails to load", async () => {
    const { stop, stream } = fakeStream();
    setCamera(async () => stream);
    const { createFrameDecoder } = await import("@/lib/input/qr-decode");
    vi.mocked(createFrameDecoder).mockRejectedValueOnce(new Error("worker blocked"));
    render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/QR decoder unavailable/)).toBeTruthy();
    expect(stop).toHaveBeenCalled();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("treats a missing createImageBitmap as decoder unavailable, without asking for the camera", async () => {
    vi.stubGlobal("createImageBitmap", undefined);
    const gum = setCamera(async () => fakeStream().stream);
    render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/QR decoder unavailable/)).toBeTruthy();
    expect(gum).not.toHaveBeenCalled();
  });

  it("in photo mode a hidden page (system camera app) keeps the modal open", () => {
    setCamera(async () => fakeStream().stream, false);
    const onClose = vi.fn();
    render(<QrScanner onResult={vi.fn()} onClose={onClose} />);
    setVisibility("hidden");
    setVisibility("visible");
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("in camera mode a hidden page stops the tracks without closing, and visible restarts the camera", async () => {
    const { stop, stream } = fakeStream();
    const gum = setCamera(async () => stream);
    const onClose = vi.fn();
    render(<QrScanner onResult={vi.fn()} onClose={onClose} />);
    await waitFor(() => expect(decoder.decode).toHaveBeenCalled());
    setVisibility("hidden");
    expect(stop).toHaveBeenCalled();
    expect(decoder.close).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    setVisibility("visible");
    await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
  });

  it("drops on the modal do not bubble to the field", () => {
    setCamera(async () => fakeStream().stream, false);
    const onDrop = vi.fn();
    render(<div onDrop={onDrop}><QrScanner onResult={vi.fn()} onClose={vi.fn()} /></div>);
    fireEvent.drop(screen.getByRole("dialog"));
    expect(onDrop).not.toHaveBeenCalled();
  });

  describe("preview mirroring", () => {
    const video = () => document.querySelector("video") as HTMLVideoElement;
    it("mirrors a user-facing camera and not an environment one (CSS only)", async () => {
      setCamera(async () => fakeStream("user").stream);
      const { unmount } = render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(video().className).toContain("-scale-x-100"));
      unmount();
      setCamera(async () => fakeStream("environment").stream);
      render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(decoder.decode).toHaveBeenCalled());
      expect(video().className).not.toContain("-scale-x-100");
    });

    it("re-evaluates when the camera is switched", async () => {
      const gum = setCamera(async (c) => {
        const exact = (c.video as MediaTrackConstraints).deviceId;
        return fakeStream(exact ? "user" : "environment", exact ? "cam-2" : "cam-1").stream;
      });
      (navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>).mockResolvedValue([
        { kind: "videoinput", deviceId: "cam-1" },
        { kind: "videoinput", deviceId: "cam-2" },
      ]);
      render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
      await waitFor(() => expect(decoder.decode).toHaveBeenCalled());
      expect(video().className).not.toContain("-scale-x-100");
      fireEvent.click(await screen.findByRole("button", { name: "Switch camera" }));
      await waitFor(() => expect(gum).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(video().className).toContain("-scale-x-100"));
    });
  });
});
