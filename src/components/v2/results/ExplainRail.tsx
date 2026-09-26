"use client";

import type { ResultViewModel } from "@/lib/view/tx-view-model";
import { ScoreBreakdown } from "./ScoreBreakdown";
import { ExposureMatrix } from "./ExposureMatrix";

interface ExplainRailProps {
  vm: ResultViewModel;
  isRevealed: (id: string) => boolean;
  highlightId: string | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}

/** L2: why the score is what it is and who can exploit it. Sticky on desktop. */
export function ExplainRail({ vm, isRevealed, highlightId, onHover, onOpen }: ExplainRailProps) {
  return (
    <aside id="v2-explain" className="min-w-0 space-y-10 xl:sticky xl:top-[calc(var(--v2-header-h,64px)+64px)]">
      {vm.waterfall.steps.length > 0 && (
        <ScoreBreakdown waterfall={vm.waterfall} findings={vm.all} isRevealed={isRevealed} highlightId={highlightId} onHover={onHover} onOpen={onOpen} zeroImpactCount={vm.visible.filter((f) => f.scoreImpact === 0).length} />
      )}
      <ExposureMatrix matrix={vm.exposure} findings={vm.visible} highlightId={highlightId} onHover={onHover} onOpen={onOpen} />
    </aside>
  );
}
