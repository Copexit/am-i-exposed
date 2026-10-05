import { describe, it, expect } from "vitest";
import { shouldMirrorPreview } from "../camera-mirror";

describe("shouldMirrorPreview", () => {
  it("mirrors facingMode user, even on a touch device", () => {
    expect(shouldMirrorPreview({ facingMode: "user", finePointer: false })).toBe(true);
  });
  it("does not mirror facingMode environment, even on desktop", () => {
    expect(shouldMirrorPreview({ facingMode: "environment", finePointer: true })).toBe(false);
  });
  it("unknown facing: mirrors on desktop, not on touch", () => {
    expect(shouldMirrorPreview({ finePointer: true })).toBe(true);
    expect(shouldMirrorPreview({ finePointer: false })).toBe(false);
  });
  it("label hints beat the pointer heuristic", () => {
    expect(shouldMirrorPreview({ label: "Integrated Webcam", finePointer: false })).toBe(true);
    expect(shouldMirrorPreview({ label: "FaceTime HD Camera", finePointer: false })).toBe(true);
    expect(shouldMirrorPreview({ label: "camera2 0, facing back", finePointer: true })).toBe(false);
    expect(shouldMirrorPreview({ label: "Rear Camera", finePointer: true })).toBe(false);
  });
  it("an unrecognised label falls back to the pointer", () => {
    expect(shouldMirrorPreview({ label: "USB2.0 HD", finePointer: true })).toBe(true);
    expect(shouldMirrorPreview({ label: "USB2.0 HD", finePointer: false })).toBe(false);
  });
});
