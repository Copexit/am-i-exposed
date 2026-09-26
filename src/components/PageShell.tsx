"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { isV2Path } from "@/lib/v2/paths";
import { V2PageFrame } from "@/components/v2/pages/V2PageFrame";

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
 * Shared layout shell for sub-pages (about, faq, glossary, welcome, etc.).
 * Provides the outer centering wrapper, back-link, and consistent spacing.
 * Under /v2/ the same content renders inside the v2 page frame instead.
 */
export function PageShell({
  backLabel,
  maxWidth = "max-w-4xl",
  spacing = "space-y-10",
  className,
  children,
}: PageShellProps) {
  const v2 = isV2Path(usePathname());
  if (v2) return <V2PageFrame spacing={spacing}>{children}</V2PageFrame>;

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
