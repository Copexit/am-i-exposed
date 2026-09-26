"use client";

import { useTheme } from "@/hooks/useTheme";
import { V2_DARK_PALETTE, V2_LIGHT_PALETTE } from "@/lib/palette";

/** The resolved v2 palette for the current theme, for JS-drawn colors (canvas, SVG, inline styles). */
export function useV2Palette() {
  return useTheme().theme === "light" ? V2_LIGHT_PALETTE : V2_DARK_PALETTE;
}
