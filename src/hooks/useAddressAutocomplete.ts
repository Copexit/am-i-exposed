"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";
import { searchEntitiesByPrefix } from "@/lib/analysis/entity-filter/entity-search";

/** Minimum prefix length before querying the address API. */
const MIN_PREFIX_LENGTH = 4;
/** Minimum query length for entity name search. */
const MIN_ENTITY_QUERY = 2;
/** Debounce delay in ms for address API calls. */
const DEBOUNCE_MS = 300;

/**
 * Partial addresses worth autocompleting: network prefix plus only bech32 or
 * base58 characters, so entity names ("MEXC", "Mt. Gox") never match.
 */
const MAINNET_PREFIX_RE = /^(?:bc1[02-9ac-hj-np-z]*|[13][1-9A-HJ-NP-Za-km-z]*)$/;
const TESTNET_PREFIX_RE = /^(?:tb1[02-9ac-hj-np-z]*|[mn2][1-9A-HJ-NP-Za-km-z]*)$/;

export interface AutocompleteSuggestion {
  type: "address" | "entity";
  /** The address to scan when selected. */
  value: string;
  /** Entity name (only for type "entity"). */
  entityName?: string;
  /** Entity category (only for type "entity"). */
  category?: string;
}

export function useAddressAutocomplete() {
  const { config, network, isUmbrel, customApiUrl } = useNetwork();
  // Partial addresses are only sent to the user's own node, never to a
  // third-party API before the user asks for a scan.
  const isOwnNode = isUmbrel || !!customApiUrl;
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isOpen, setIsOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seqRef = useRef(0);

  // Cleanup on unmount
  useEffect(() => () => {
    clearTimeout(timerRef.current);
    abortRef.current?.abort();
  }, []);

  const fetchSuggestions = useCallback((prefix: string) => {
    clearTimeout(timerRef.current);

    const trimmed = prefix.trim();

    // Exclude txids (64 hex), xpubs, PSBTs
    if (
      /^[0-9a-f]{20,}$/i.test(trimmed) ||
      trimmed.startsWith("xpub") ||
      trimmed.startsWith("ypub") ||
      trimmed.startsWith("zpub")
    ) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    // bech32 is case-insensitive (QR codes use uppercase); base58 is not
    const addrQuery = /^(?:bc1|tb1)/i.test(trimmed) ? trimmed.toLowerCase() : trimmed;
    const isAddressPrefix = (network === "mainnet" ? MAINNET_PREFIX_RE : TESTNET_PREFIX_RE).test(addrQuery);

    // Path 1: Address prefix autocomplete (API call with debounce)
    if (isAddressPrefix && isOwnNode && trimmed.length >= MIN_PREFIX_LENGTH) {
      const seq = ++seqRef.current;

      const fetchSuggestions = async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const client = createApiClient(config, controller.signal);
          const results = await client.getAddressPrefix(addrQuery);
          if (seq === seqRef.current && results.length > 0) {
            setSuggestions(results.map((addr) => ({ type: "address" as const, value: addr })));
            setSelectedIndex(-1);
            setIsOpen(true);
          } else if (seq === seqRef.current) {
            setSuggestions([]);
            setIsOpen(false);
          }
        } catch {
          if (seq === seqRef.current) {
            setSuggestions([]);
            setIsOpen(false);
          }
        }
      };
      // Fire-and-forget: fetchSuggestions catches its own errors.
      timerRef.current = setTimeout(() => void fetchSuggestions(), DEBOUNCE_MS);
      return;
    }

    // Path 2: Entity name autocomplete (synchronous, no API call)
    if (!isAddressPrefix && trimmed.length >= MIN_ENTITY_QUERY) {
      const entityResults = searchEntitiesByPrefix(trimmed, 10);
      if (entityResults.length > 0) {
        setSuggestions(
          entityResults.map((e) => ({
            type: "entity" as const,
            value: e.address,
            entityName: e.entityName,
            category: e.category,
          })),
        );
        setSelectedIndex(-1);
        setIsOpen(true);
      } else {
        setSuggestions([]);
        setIsOpen(false);
      }
      return;
    }

    // Neither path matched
    setSuggestions([]);
    setIsOpen(false);
  }, [config, network, isOwnNode]);

  const close = useCallback(() => {
    setIsOpen(false);
    setSelectedIndex(-1);
  }, []);

  const selectIndex = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const moveSelection = useCallback((delta: number) => {
    setSelectedIndex((prev) => {
      const len = suggestions.length;
      if (len === 0) return -1;
      const next = prev + delta;
      if (next < 0) return len - 1;
      if (next >= len) return 0;
      return next;
    });
  }, [suggestions.length]);

  const getSelected = useCallback((): string | null => {
    return suggestions[selectedIndex]?.value ?? null;
  }, [selectedIndex, suggestions]);

  return {
    suggestions,
    selectedIndex,
    isOpen,
    fetchSuggestions,
    close,
    selectIndex,
    moveSelection,
    getSelected,
  };
}
