"use client";

import type { ReactNode } from "react";
import { PageFrame } from "@/components/pages/PageFrame";

interface PageShellProps {
  /** Tailwind spacing class between children (default "space-y-10") */
  spacing?: string;
  /** See PageFrame. */
  compact?: boolean;
  /** See PageFrame. */
  eyebrow?: string;
  children: ReactNode;
}

/** Shared layout shell for sub-pages (about, faq, glossary, guide, etc.): the page frame. */
export function PageShell({ spacing = "space-y-10", compact, eyebrow, children }: PageShellProps) {
  return <PageFrame spacing={spacing} compact={compact} eyebrow={eyebrow}>{children}</PageFrame>;
}
