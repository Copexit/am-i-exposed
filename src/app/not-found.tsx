"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-7xl font-bold text-muted/30 tabular-nums">404</p>
      <h1 className="mt-4 text-xl font-semibold text-foreground">
        {t("errors.page_not_found", { defaultValue: "Page not found" })}
      </h1>
      <p className="mt-2 text-sm text-muted max-w-sm">
        {t("errors.page_moved", { defaultValue: "The page you are looking for does not exist or has been moved." })}
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bitcoin text-background font-semibold hover:bg-bitcoin-hover transition-all text-sm"
      >
        <ArrowLeft size={14} />
        {t("common.backToScanner", { defaultValue: "Back to scanner" })}
      </Link>
    </div>
  );
}
