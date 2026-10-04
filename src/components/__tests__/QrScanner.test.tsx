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

function fakeStream() {
  const stop = vi.fn();
  const track = { stop, getSettings: () => ({ deviceId: "cam-1" }) };
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
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("QrScanner", () => {
  it("without a secure context offers only the photo input and never asks for the camera", () => {
    const gum = setCamera(async () => fakeStream().stream, false);
    const { container } = render(<QrScanner onResult={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/camera needs HTTPS/)).toBeTruthy();
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
});
