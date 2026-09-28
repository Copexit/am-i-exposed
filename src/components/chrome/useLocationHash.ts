"use client";

import { useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

/** Current `location.hash`, reactive to hashchange ("" on the server). */
export function useLocationHash(): string {
  return useSyncExternalStore(subscribe, () => window.location.hash, () => "");
}
