import { ApiError } from "./fetch-with-retry";
import { isBraveBrowser } from "@/lib/browser";
import type { HeuristicTranslator } from "@/lib/analysis/heuristics/types";

interface ErrorMessageContext {
  isUmbrel: boolean;
  isCustomApi: boolean;
  /** Message for errors that are neither ApiError nor a fetch TypeError (e.g. a parse error). */
  fallback?: string;
}

/** Map a fetch/analysis error to a translated user-facing message. Shared by all analysis hooks. */
export function mapApiErrorMessage(
  err: unknown,
  t: HeuristicTranslator,
  { isUmbrel, isCustomApi, fallback }: ErrorMessageContext,
): { message: string; retryable: boolean } {
  const unexpected = () => fallback ?? t("errors.unexpected", { defaultValue: "An unexpected error occurred." });

  if (err instanceof ApiError) {
    switch (err.code) {
      case "NOT_FOUND":
        return {
          message: t("errors.not_found", { defaultValue: "Not found. Check that the address or transaction ID is correct and exists on the selected network." }),
          retryable: false,
        };
      case "INVALID_INPUT":
        return { message: unexpected(), retryable: false };
      case "RATE_LIMITED":
        return {
          message: t("errors.rate_limited", { defaultValue: "Rate limited by mempool.space. Please wait a moment and try again." }),
          retryable: true,
        };
      case "NETWORK_ERROR":
        return {
          message: isUmbrel
            ? t("errors.network_umbrel", { defaultValue: "Connection to local mempool failed. Try restarting mempool from your Umbrel dashboard." })
            : isCustomApi
              ? t("errors.network_custom", { defaultValue: "Connection to your custom endpoint failed. Open API settings to troubleshoot." })
              : t("errors.network", { defaultValue: "Network error. Check your internet connection or try again later." }),
          retryable: true,
        };
      case "API_UNAVAILABLE":
        return {
          message: isUmbrel
            ? t("errors.api_umbrel", { defaultValue: "Local mempool returned an error. This address may have too many transactions for the Electrum backend to handle. Try restarting mempool or analyzing a different address." })
            : isCustomApi
              ? t("errors.api_custom", { defaultValue: "Your custom API endpoint returned an error. Check that it is running." })
              : t("errors.api_unavailable", { defaultValue: "The API is temporarily unavailable. Please try again later." }),
          retryable: true,
        };
    }
  }

  // TypeError: Failed to fetch - likely blocked by browser shields or CSP
  if (err instanceof Error && err.name === "TypeError") {
    return {
      message: isBraveBrowser()
        ? t("errors.brave_shields", {
            defaultValue:
              "Request blocked by Brave Shields. Click the Shields icon in the address bar and disable Shields for this site, then retry.",
          })
        : t("errors.fetch_blocked", {
            defaultValue:
              "API request was blocked by the browser. If using a privacy browser, allow connections to mempool.space for this site.",
          }),
      retryable: true,
    };
  }

  return { message: unexpected(), retryable: true };
}
