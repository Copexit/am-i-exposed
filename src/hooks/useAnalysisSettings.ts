"use client";

import { useSyncExternalStore, useCallback } from "react";
import {
  DEFAULT_ANALYSIS_SETTINGS,
  getAnalysisSettings,
  saveAnalysisSettings,
  subscribeAnalysisSettings,
  type AnalysisSettings,
} from "@/lib/analysis/settings";

export { getAnalysisSettings, type AnalysisSettings };

const getServerSnapshot = () => DEFAULT_ANALYSIS_SETTINGS;

export function useAnalysisSettings() {
  const settings = useSyncExternalStore(subscribeAnalysisSettings, getAnalysisSettings, getServerSnapshot);

  const update = useCallback((partial: Partial<AnalysisSettings>) => {
    saveAnalysisSettings({ ...getAnalysisSettings(), ...partial });
  }, []);

  const reset = useCallback(() => {
    saveAnalysisSettings(DEFAULT_ANALYSIS_SETTINGS);
  }, []);

  return { settings, update, reset, DEFAULTS: DEFAULT_ANALYSIS_SETTINGS };
}
