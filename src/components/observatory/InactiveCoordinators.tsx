"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { WabiSabiCoordinatorCard } from "./WabiSabiCoordinatorCard";
import { fmtN } from "@/lib/format";
import type { CoordinatorView } from "@/lib/observatory/types";

interface InactiveCoordinatorsProps {
  coordinators: CoordinatorView[];
  avgAnonIn: number | null;
  avgAnonOut: number | null;
}

/**
 * Coordinators idle for 30+ days are hidden behind a toggle rather than mixed
 * into the active grid, keeping them discoverable without cluttering the page.
 */
export function InactiveCoordinators({
  coordinators,
  avgAnonIn,
  avgAnonOut,
}: InactiveCoordinatorsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  if (coordinators.length === 0) return null;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-sm font-medium text-muted hover:text-foreground transition-colors"
      >
        {open
          ? t("observatory.wabisabi.hideInactive", {
              defaultValue: "Hide inactive coordinators",
            })
          : t("observatory.wabisabi.showInactive", {
              defaultValue: "Show {{n}} inactive (30d+)",
              n: fmtN(coordinators.length),
            })}
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {coordinators.map((c) => (
            <WabiSabiCoordinatorCard
              key={c.endpoint}
              coordinator={c}
              avgAnonIn={avgAnonIn}
              avgAnonOut={avgAnonOut}
            />
          ))}
        </div>
      )}
    </div>
  );
}
