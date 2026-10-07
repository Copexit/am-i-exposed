/**
 * External services reachable through am-i.exposed's own hops (the
 * coinjoin-stats worker on the public site, the tor-proxy sidecar when
 * self-hosted). registry.json is the single source of truth; the worker
 * bundles it and the sidecar ships a committed copy (services.json).
 */
import registry from "./registry.json";

export type ServiceClass = "aggregate" | "lookup";
export type ParamValidator = "txid" | "page" | "offset";
export interface NostrFilter { kinds: number[]; authors?: string[]; limit: number; [tag: `#${string}`]: string[] | undefined }
export interface RpcSpec { class: ServiceClass; ttl?: number; params?: Record<string, ParamValidator> }
export interface ServiceRoute {
  path: string;
  http: "GET" | "POST";
  class?: ServiceClass;
  ttl?: number;
  timeoutMs?: number;
  query?: Record<string, ParamValidator>;
  rpc?: Record<string, RpcSpec>;
  /** Appended after the validated params; the client cannot override them. */
  fixedQuery?: Record<string, string>;
  /** Proxy runs this fixed filter against the service relays and returns a snapshot. */
  nostr?: { filter: NostrFilter; sinceSeconds?: number };
}
export interface ServiceDef {
  id: string;
  name: string;
  kind: "data-provider" | "wabisabi-coordinator" | "p2p-exchange" | "nostr-relay";
  homepage: string;
  base?: string;
  onion?: string;
  relays?: string[];
  onionRelays?: string[];
  /** UI metadata for the Observatory P2P tab; nothing else reads it. */
  p2p?: { venue: "robosats" | "mostro" | "hodlhodl"; key: string; pubkey?: string };
  routes: ServiceRoute[];
}

export const SERVICES = (registry as { services: ServiceDef[] }).services;

/** Public site: needs base (or relays for nostr services). Self-hosted: base, onion or relays. */
export function isReachable(s: ServiceDef, isUmbrel: boolean): boolean {
  return Boolean(s.base || s.relays?.length || (isUmbrel && s.onion));
}

export const getService = (id: string) => SERVICES.find((s) => s.id === id);

export function findRpc(serviceId: string, path: string, method: string): RpcSpec | undefined {
  const route = getService(serviceId)?.routes.find((r) => r.http === "POST" && r.path === path);
  return route?.rpc && Object.hasOwn(route.rpc, method) ? route.rpc[method] : undefined;
}

export function findGetRoute(serviceId: string, path: string): ServiceRoute | undefined {
  return getService(serviceId)?.routes.find((r) => r.http === "GET" && r.path === path);
}

/** Normalized value, or null when the value is not acceptable. */
export function validateParam(kind: ParamValidator, value: unknown): string | null {
  if (kind === "txid") {
    if (typeof value !== "string") return null;
    const v = value.trim().toLowerCase();
    return /^[0-9a-f]{64}$/.test(v) ? v : null;
  }
  if (kind === "offset") {
    const n = parseInt(String(value ?? "0"), 10);
    if (!Number.isFinite(n) || n < 0) return "0";
    return String(Math.floor(Math.min(n, 5000) / 100) * 100);
  }
  const n = parseInt(String(value ?? "1"), 10);
  return String(!Number.isFinite(n) || n < 1 ? 1 : Math.min(n, 10_000));
}
