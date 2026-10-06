const WORKER_BASE = "https://coinjoin-stats.copexit.workers.dev";
const UMBREL_BASE = "/tor-proxy";

/** Public site goes through the worker, self-hosted through the tor-proxy sidecar. */
export function serviceUrl(serviceId: string, path: string, { isUmbrel }: { isUmbrel: boolean }): string {
  return `${isUmbrel ? UMBREL_BASE : WORKER_BASE}/svc/${serviceId}${path}`;
}
