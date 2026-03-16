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

/** Regex for partial address prefixes worth autocompleting. */
const ADDRESS_PREFIX_RE = /^(bc1|tb1|[13]|[mn2])/i;

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
  const { config } = useNetwork();
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

    const isAddressPrefix = ADDRESS_PREFIX_RE.test(trimmed);

    // Path 1: Address prefix autocomplete (API call with debounce)
    if (isAddressPrefix && trimmed.length >= MIN_PREFIX_LENGTH) {
      const seq = ++seqRef.current;

      timerRef.current = setTimeout(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const client = createApiClient(config, controller.signal);
          const results = await client.getAddressPrefix(trimmed);
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
      }, DEBOUNCE_MS);
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
  }, [config]);

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
    if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
      return suggestions[selectedIndex].value;
    }
    return null;
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
