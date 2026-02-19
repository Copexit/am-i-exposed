/**
 * Pre-flight URL diagnostics for custom mempool API endpoints.
 * Detects mixed content, .onion targets, and local network URLs
 * before the health-check fetch fires, so the UI can show
 * actionable guidance instead of generic "connection failed".
 */

export interface UrlDiagnostic {
  /** HTTPS page trying to fetch from HTTP non-localhost URL */
  isMixedContent: boolean;
  /** Target host is a .onion Tor hidden service */
  isOnion: boolean;
  /** Target host is local (.local, private IP, localhost) */
  isLocal: boolean;
  /** Human-readable hint when a known barrier is detected, or null */
  hint: string | null;
}

const PRIVATE_IP_RE =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;

function isLocalhostHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function isLocalNetworkHost(hostname: string): boolean {
  return (
    isLocalhostHost(hostname) ||
    hostname.endsWith(".local") ||
    PRIVATE_IP_RE.test(hostname)
  );
}

export function diagnoseUrl(url: string): UrlDiagnostic {
  const result: UrlDiagnostic = {
    isMixedContent: false,
    isOnion: false,
    isLocal: false,
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
  result.isLocal = isLocalNetworkHost(hostname);

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
    result.hint =
      "Ensure you are using Tor Browser to reach .onion addresses. " +
      "Your node also needs CORS headers for cross-origin requests.";
  }

  return result;
}
