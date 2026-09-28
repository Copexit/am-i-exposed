"use client";

import type { ReactNode } from "react";
import { V2PageFrame } from "@/components/v2/pages/V2PageFrame";

interface PageShellProps {
  /** Tailwind spacing class between children (default "space-y-10") */
  spacing?: string;
  children: ReactNode;
}

/** Shared layout shell for sub-pages (about, faq, glossary, guide, etc.): the page frame. */
export function PageShell({ spacing = "space-y-10", children }: PageShellProps) {
  return <V2PageFrame spacing={spacing}>{children}</V2PageFrame>;
}
