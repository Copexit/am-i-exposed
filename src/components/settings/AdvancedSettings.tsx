"use client";

import { NetworkSettings } from "./NetworkSettings";
import { AnalysisSettingsPanel } from "./AnalysisSettingsPanel";
import { CacheSettingsPanel } from "./CacheSettingsPanel";
import { WorkspaceSettingsPanel } from "./WorkspaceSettingsPanel";
import { EntityFilterStatus } from "./EntityFilterStatus";

/**
 * The heavier settings sections (API diagnostics, analysis, cache, entity data).
 * Loaded on demand by ApiSettings so the site chrome does not ship the entity
 * filter, OFAC list or API client on every page.
 */
export default function AdvancedSettings({ isUmbrel, onClosePanel }: { isUmbrel: boolean; onClosePanel: () => void }) {
  return (
    <>
      <WorkspaceSettingsPanel />
      {/* Advanced API settings - hidden on Umbrel (API is preconfigured) */}
      {!isUmbrel && <NetworkSettings onClosePanel={onClosePanel} />}
      <AnalysisSettingsPanel />
      <CacheSettingsPanel />
      <EntityFilterStatus />
    </>
  );
}
