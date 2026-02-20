"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export function LangAttributeSync() {
  const { i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = (i18n.language ?? "en").split("-")[0];
  }, [i18n.language]);

  return null;
}
