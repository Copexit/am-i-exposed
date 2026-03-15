/**
 * Pre-flight URL diagnostics for custom mempool API endpoints.
 * Detects mixed content, .onion targets, and local network URLs
 * before the health-check fetch fires, so the UI can show
 * actionable guidance instead of generic "connection failed".
 */

import { isLocalApi } from "./client";

interface UrlDiagnostic {
  /** HTTPS page trying to fetch from HTTP non-localhost URL */
  isMixedContent: boolean;
  /** Target host is a .onion Tor hidden service */
  isOnion: boolean;
  /** Target host is local (.local, private IP, localhost) */
  isLocal: boolean;
  /** URL path does not end with /api */
  isMissingApiSuffix: boolean;
  /** Human-readable hint when a known barrier is detected, or null */
  hint: string | null;
}

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function diagnoseUrl(url: string): UrlDiagnostic {
  const result: UrlDiagnostic = {
    isMixedContent: false,
    isOnion: false,
    isLocal: false,
    isMissingApiSuffix: false,
    hint: null,
  };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return result;
  }

  const hostname = parsed.hostname;
  const isHttpTarget = parsed.protocol === "http:";
  const pageIsHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";

  result.isOnion = hostname.endsWith(".onion");
  // Use the shared isLocalApi check but exclude .onion (tracked separately)
  result.isLocal = !result.isOnion && isLocalApi(url);

  // Check if URL path ends with /api (required for mempool API calls)
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const looksLikeNode = parsed.port !== "" || result.isLocal;
  result.isMissingApiSuffix = !pathname.endsWith("/api") && looksLikeNode;

  // Mixed content: HTTPS page fetching HTTP URL (localhost is exempt)
  if (pageIsHttps && isHttpTarget && !isLocalhostHost(hostname)) {
    result.isMixedContent = true;
  }

  // Build hint based on detected barriers
  if (result.isMixedContent && result.isOnion) {
    result.hint =
      "This HTTPS page cannot fetch from an HTTP .onion address. " +
      "Use Tor Browser with the .onion version of this site, " +
      "or set up an HTTPS reverse proxy for your node.";
  } else if (result.isMixedContent && result.isLocal) {
    result.hint =
      "Your browser blocks HTTP requests from this HTTPS page. " +
      "Use SSH port forwarding to access your node via localhost:\n" +
      "ssh -L 3006:localhost:3006 umbrel@umbrel.local\n" +
      "Then use http://localhost:3006/api";
  } else if (result.isMixedContent) {
    result.hint =
      "Your browser blocks HTTP requests from this HTTPS page. " +
      "Set up HTTPS on your node, or use SSH port forwarding to localhost.";
  } else if (result.isOnion) {
    // No warning needed for the well-known mempool.space .onion
    const isKnownMempool = hostname.startsWith("mempoolhqx4isw62");
    if (!isKnownMempool) {
      const pageIsOnion =
        typeof window !== "undefined" &&
        window.location.hostname.endsWith(".onion");
      result.hint = pageIsOnion
        ? "Your node needs CORS headers to allow cross-origin requests."
        : "Ensure you are using Tor Browser to reach .onion addresses. " +
          "Your node also needs CORS headers for cross-origin requests.";
    }
  }

  // Append /api suffix hint if applicable
  if (result.isMissingApiSuffix) {
    const trimmedUrl = url.replace(/\/+$/, "");
    const apiHint =
      "This URL does not end with /api. Mempool instances serve " +
      "their API at the /api path.\n" +
      "Try: " + trimmedUrl + "/api";
    result.hint = result.hint ? result.hint + "\n\n" + apiHint : apiHint;
  }

  return result;
}
