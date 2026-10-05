/**
 * Whether the camera preview should be mirrored (CSS only, decoding uses raw frames).
 * A user-facing camera (laptop webcam, selfie camera) is mirrored so that moving the QR
 * code left moves it left on screen, like a mirror.
 *
 * Order: facingMode if the browser reports it, then device label hints, then a pointer
 * heuristic (a fine, non-coarse pointer means a desktop, whose cameras face the user).
 */
export function shouldMirrorPreview({ facingMode, label, finePointer }: {
  facingMode?: string;
  label?: string;
  finePointer: boolean;
}): boolean {
  if (facingMode === "user") return true;
  if (facingMode === "environment") return false;
  if (label) {
    if (/back|rear|environment/i.test(label)) return false;
    if (/front|user|facetime|integrated|webcam/i.test(label)) return true;
  }
  return finePointer;
}

/** Desktop-like device: precise pointer and no coarse pointer (touch phones and tablets). */
export function hasFinePointerOnly(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(pointer: fine)").matches && !window.matchMedia("(pointer: coarse)").matches;
}
