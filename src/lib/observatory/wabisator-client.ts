import { serviceRpc } from "@/lib/services/client";
import { withObservatoryCache } from "./cache";
import type { CoordinatorsStatus, FlowMap, RoundsPage, VolumeHistory } from "./wabisator-types";

export type Period = 1 | 7 | 30;
interface Opts { isUmbrel: boolean; signal?: AbortSignal }

export const REFRESH_MS = {
  flowMap: { 1: 20_000, 7: 60_000, 30: 120_000 } as Record<Period, number>,
  status: 10_000,
  volume: 600_000,
  rounds: 60_000,
};

const ROUNDS_PAGE_SIZE = 25;

/** `until` is floored to 5 minutes so the worker edge cache is shared across visitors. */
export function flowMapWindow(period: Period, nowSec: number): { since: number; until: number } {
  const until = Math.floor(nowSec / 300) * 300;
  return { since: until - period * 86400, until };
}

const call = <T>(method: string, params: Record<string, unknown>, ttl: number, { isUmbrel, signal }: Opts) =>
  withObservatoryCache(`wabisator:${method}:${JSON.stringify(params)}`, () => serviceRpc<T>("wabisator", "/api.php", method, params, { isUmbrel, signal }), ttl);

export function getFlowMap(period: Period, opts: Opts & { nowSec?: number }): Promise<FlowMap> {
  return call("flow-map", flowMapWindow(period, opts.nowSec ?? Date.now() / 1000), REFRESH_MS.flowMap[period], opts);
}

export const getCoordinatorsStatus = (opts: Opts): Promise<CoordinatorsStatus> =>
  call("coordinators-status", {}, REFRESH_MS.status, opts);

export const getVolumeHistory = (opts: Opts): Promise<VolumeHistory> =>
  call("volume-history", {}, REFRESH_MS.volume, opts);

export const getRounds = (coordinator: string, page: number, opts: Opts): Promise<RoundsPage> =>
  call("rounds-paginated", { coordinatorEndpoint: [coordinator], page, pageSize: ROUNDS_PAGE_SIZE }, REFRESH_MS.rounds, opts);
