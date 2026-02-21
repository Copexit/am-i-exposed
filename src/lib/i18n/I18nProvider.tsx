"use client";

import { I18nextProvider } from "react-i18next";
import { MotionConfig } from "motion/react";
import i18n from "./config";
import { type ReactNode } from "react";

export function I18nProvider({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </I18nextProvider>
  );
}
