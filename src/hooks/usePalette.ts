"use client";

import { useTheme } from "@/hooks/useTheme";
import { DARK_PALETTE, LIGHT_PALETTE } from "@/lib/palette";

/** The resolved palette for the current theme, for JS-drawn colors (canvas, SVG, inline styles). */
export function usePalette() {
  return useTheme().theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
}
