/**
 * External services reachable through am-i.exposed's own hops (the
 * coinjoin-stats worker on the public site, the tor-proxy sidecar when
 * self-hosted). registry.json is the single source of truth; the worker
 * bundles it and the sidecar ships a committed copy (services.json).
 */
import registry from "./registry.json";

export type ServiceClass = "aggregate" | "lookup";
export type ParamValidator = "txid" | "page";
export interface RpcSpec { class: ServiceClass; ttl?: number; params?: Record<string, ParamValidator> }
export interface ServiceRoute {
  path: string;
  http: "GET" | "POST";
  class?: ServiceClass;
  ttl?: number;
  timeoutMs?: number;
  query?: Record<string, ParamValidator>;
  rpc?: Record<string, RpcSpec>;
}
export interface ServiceDef {
  id: string;
  name: string;
  kind: "data-provider" | "wabisabi-coordinator" | "p2p-exchange" | "nostr-relay";
  homepage: string;
  base: string;
  onion?: string;
  routes: ServiceRoute[];
}

export const SERVICES = (registry as { services: ServiceDef[] }).services;

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
  const n = parseInt(String(value ?? "1"), 10);
  return String(!Number.isFinite(n) || n < 1 ? 1 : Math.min(n, 10_000));
}
