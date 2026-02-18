"use client";

import { useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  type BitcoinNetwork,
  DEFAULT_NETWORK,
  isValidNetwork,
} from "@/lib/bitcoin/networks";

export function useUrlState() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawNetwork = searchParams.get("network");
  const network: BitcoinNetwork =
    rawNetwork && isValidNetwork(rawNetwork) ? rawNetwork : DEFAULT_NETWORK;

  const setNetwork = useCallback(
    (n: BitcoinNetwork) => {
      const params = new URLSearchParams(searchParams.toString());
      if (n === DEFAULT_NETWORK) {
        params.delete("network");
      } else {
        params.set("network", n);
      }
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [searchParams, router],
  );

  return { network, setNetwork };
}
