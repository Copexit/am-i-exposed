"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    console.error("am-i.exposed error boundary caught:", error);
  }, [error]);

  return (
    <div className="flex-1 flex items-center justify-center px-4 py-12">
      <div className="text-center space-y-4 max-w-md">
        <h2 className="text-xl font-semibold text-foreground">
          {t("errors.boundary_title", { defaultValue: "Something went wrong" })}
        </h2>
        <p className="text-muted text-sm leading-relaxed">
          {t("errors.boundary_description", { defaultValue: "An unexpected error occurred. This is usually temporary - try refreshing the page or starting over." })}
        </p>
        <button
          onClick={reset}
          className="px-5 py-2.5 bg-bitcoin text-black font-semibold text-sm rounded-lg
            hover:bg-bitcoin-hover transition-colors cursor-pointer"
        >
          {t("errors.try_again", { defaultValue: "Try again" })}
        </button>
      </div>
    </div>
  );
}
