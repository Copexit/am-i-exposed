"use client";

import { usePathname } from "next/navigation";
import { isV2Path } from "@/lib/v2/paths";

/** Renders its children only outside the v2 UI (which brings its own chrome). */
export function ClassicOnly({ children }: { children: React.ReactNode }) {
  return isV2Path(usePathname()) ? null : <>{children}</>;
}

/** The page's <main>: classic pages reserve space for the fixed classic header. */
export function AppMain({ children }: { children: React.ReactNode }) {
  const v2 = isV2Path(usePathname());
  return (
    <main id="main-content" className={v2 ? "flex-1 flex flex-col" : "flex-1 flex flex-col pt-[72px] sm:pt-[80px]"}>
      {children}
    </main>
  );
}
