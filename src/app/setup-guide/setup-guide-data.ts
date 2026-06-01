/** Static data for the setup guide page. */

export const CORS_SNIPPET = `# Add these lines inside your existing location /api/ { } block
add_header 'Access-Control-Allow-Origin' '*' always;
add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
if ($request_method = 'OPTIONS') {
  return 204;
}`;

export const CADDY_SNIPPET = `:8090 {
  reverse_proxy localhost:3006
  header Access-Control-Allow-Origin *
  header Access-Control-Allow-Methods "GET, OPTIONS"
  @options method OPTIONS
  respond @options 204
}`;

export interface TocItem {
  labelKey: string;
  labelDefault: string;
  id: string;
}

export const TOC_ITEMS: TocItem[] = [
  { labelKey: "setup.toc_why", labelDefault: "Why Self-Host", id: "why" },
  { labelKey: "setup.toc_umbrel", labelDefault: "Umbrel App", id: "umbrel" },
  { labelKey: "setup.toc_start9", labelDefault: "StartOS App", id: "start9" },
  { labelKey: "setup.toc_advanced", labelDefault: "Advanced Setup", id: "advanced" },
];

export interface TroubleshootingItem {
  errorKey: string;
  errorDefault: string;
  causeKey: string;
  causeDefault: string;
  fixKey: string;
  fixDefault: string;
}

export const TROUBLESHOOTING_ITEMS: TroubleshootingItem[] = [
  {
    errorKey: "setup.ts_cors_error",
    errorDefault: "\"Connection failed\" after setting up SSH tunnel",
    causeKey: "setup.ts_cors_cause",
    causeDefault: "Missing CORS headers",
    fixKey: "setup.ts_cors_fix",
    fixDefault: "This is the #1 issue. Your SSH tunnel works at the network level, but your browser blocks the response because mempool's nginx does not include CORS headers. Add the CORS headers from Step 1 and reload nginx.",
  },
  {
    errorKey: "setup.ts_mixed_error",
    errorDefault: "\"Blocked: HTTP from HTTPS page\"",
    causeKey: "setup.ts_mixed_cause",
    causeDefault: "Mixed content",
    fixKey: "setup.ts_mixed_fix",
    fixDefault: "You are entering an HTTP URL that is not localhost (e.g., http://umbrel.local:3006). Use an SSH tunnel to forward the port to localhost, then use http://localhost:3006/api.",
  },
  {
    errorKey: "setup.ts_api_error",
    errorDefault: "Health check passes but analysis returns no results",
    causeKey: "setup.ts_api_cause",
    causeDefault: "Missing /api suffix",
    fixKey: "setup.ts_api_fix",
    fixDefault: "Make sure your URL ends with /api. For example, http://localhost:3006/api - not http://localhost:3006. The app will warn you about this if it detects a missing suffix.",
  },
  {
    errorKey: "setup.ts_timeout_error",
    errorDefault: "\"Timeout (10s)\"",
    causeKey: "setup.ts_timeout_cause",
    causeDefault: "No connection",
    fixKey: "setup.ts_timeout_fix",
    fixDefault: "Check that your SSH tunnel is still running (the terminal session must stay open). Verify the port number matches your mempool instance. Check firewall rules on your node.",
  },
  {
    errorKey: "setup.ts_502_error",
    errorDefault: "\"HTTP 502\" or \"HTTP 503\"",
    causeKey: "setup.ts_502_cause",
    causeDefault: "Backend not ready",
    fixKey: "setup.ts_502_fix",
    fixDefault: "Your mempool frontend (nginx) is reachable, but the backend is not responding. This usually means the mempool backend is still syncing the blockchain. Wait for it to finish and try again.",
  },
  {
    errorKey: "setup.ts_restart_error",
    errorDefault: "CORS changes lost after Umbrel restart",
    causeKey: "setup.ts_restart_cause",
    causeDefault: "Docker container recreated",
    fixKey: "setup.ts_restart_fix",
    fixDefault: "Umbrel recreates containers on updates. You need to re-apply CORS headers after each restart, or mount a persistent custom nginx config via Docker volume.",
  },
];
