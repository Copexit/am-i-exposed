"use client";

import { useEffect, useRef } from "react";
import { I18nextProvider } from "react-i18next";
import { MotionConfig } from "motion/react";
import i18n, { detectPreferredLanguage } from "./config";
import { type ReactNode } from "react";

export function I18nProvider({ children }: { children: ReactNode }) {
  const applied = useRef(false);

  // Apply detected language after hydration to avoid server/client mismatch.
  // The i18n config initializes with "en" so the first render matches the
  // static HTML. This effect switches to the user's preferred language.
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const preferred = detectPreferredLanguage();
    if (preferred !== "en") {
      i18n.changeLanguage(preferred);
    }
  }, []);

  return (
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </I18nextProvider>
  );
}
