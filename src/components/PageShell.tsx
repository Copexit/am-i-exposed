"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

interface PageShellProps {
  /** The translated back-link label, e.g. "Back to scanner" */
  backLabel: string;
  /** Tailwind max-width class (default "max-w-4xl") */
  maxWidth?: string;
  /** Tailwind spacing class for the inner wrapper (default "space-y-10") */
  spacing?: string;
  /** Extra classes on the outer centering container (e.g. wider padding) */
  className?: string;
  children: ReactNode;
}

/**
 * Shared layout shell for sub-pages (about, faq, glossary, methodology, etc.).
 * Provides the outer centering wrapper, back-link, and consistent spacing.
 */
export function PageShell({
  backLabel,
  maxWidth = "max-w-4xl",
  spacing = "space-y-10",
  className,
  children,
}: PageShellProps) {
  return (
    <div className={`flex-1 flex flex-col items-center px-4 py-8 ${className ?? ""}`}>
      <div className={`w-full ${maxWidth} ${spacing}`}>
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </Link>

        {children}
      </div>
    </div>
  );
}
