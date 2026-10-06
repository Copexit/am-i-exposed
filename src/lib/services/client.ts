import { getJson, postJsonRpc } from "@/lib/observatory/transport";
import { ConsentRequiredError, isGrantedConsent, type LookupConsent } from "./consent";
import { findRpc, validateParam } from "./registry";
import { serviceUrl } from "./route";

interface CallOpts {
  isUmbrel: boolean;
  signal?: AbortSignal;
}

export async function serviceRpc<T>(
  serviceId: string,
  path: string,
  method: string,
  params: Record<string, unknown>,
  opts: CallOpts & { consent?: LookupConsent },
): Promise<T> {
  const spec = findRpc(serviceId, path, method);
  if (!spec) throw new Error("Unknown service method");
  const sent: Record<string, unknown> = { ...params };
  const txids: string[] = [];
  for (const [key, kind] of Object.entries(spec.params ?? {})) {
    const v = validateParam(kind, params[key]);
    if (v === null) throw new Error(`Invalid param: ${key}`);
    sent[key] = v;
    if (kind === "txid") txids.push(v);
  }
  if (spec.class === "lookup") {
    const c = opts.consent;
    if (!isGrantedConsent(c) || c.serviceId !== serviceId || !txids.every((t) => c.txids.has(t))) {
      throw new ConsentRequiredError();
    }
  }
  return postJsonRpc<T>(serviceUrl(serviceId, path, opts), method, sent, { signal: opts.signal });
}

export function serviceGet<T>(
  serviceId: string,
  path: string,
  opts: CallOpts & { query?: Record<string, string | number> },
): Promise<T> {
  const qs = opts.query
    ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]) => [k, String(v)]))}`
    : "";
  return getJson<T>(serviceUrl(serviceId, path, opts) + qs, { signal: opts.signal });
}
