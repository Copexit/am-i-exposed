"use client";

import { usePolled, type Polled } from "./usePolled";
import { useNetwork } from "@/context/NetworkContext";
import {
  getCoordinatorsStatus, getFlowMap, getRounds, getVolumeHistory, REFRESH_MS, type Period,
} from "@/lib/observatory/wabisator-client";
import type { CoordinatorsStatus, FlowMap, RoundsPage, VolumeHistory } from "@/lib/observatory/wabisator-types";

export { usePolled, type Polled } from "./usePolled";

export function useFlowMap(period: Period): Polled<FlowMap> {
  const { isUmbrel, routeReady } = useNetwork();
  return usePolled(routeReady ? `flow:${period}:${isUmbrel}` : null, (signal) => getFlowMap(period, { isUmbrel, signal }), REFRESH_MS.flowMap[period]);
}

export function useCoordinatorsStatus(): Polled<CoordinatorsStatus> {
  const { isUmbrel, routeReady } = useNetwork();
  return usePolled(routeReady ? `status:${isUmbrel}` : null, (signal) => getCoordinatorsStatus({ isUmbrel, signal }), REFRESH_MS.status);
}

export function useVolumeHistory(): Polled<VolumeHistory> {
  const { isUmbrel, routeReady } = useNetwork();
  return usePolled(routeReady ? `volume:${isUmbrel}` : null, (signal) => getVolumeHistory({ isUmbrel, signal }), REFRESH_MS.volume);
}

export function useRounds(coordinator: string | null, page: number): Polled<RoundsPage> {
  const { isUmbrel, routeReady } = useNetwork();
  return usePolled(!routeReady || coordinator === null ? null : `rounds:${coordinator}:${page}:${isUmbrel}`, (signal) => getRounds(coordinator ?? "", page, { isUmbrel, signal }), REFRESH_MS.rounds);
}
