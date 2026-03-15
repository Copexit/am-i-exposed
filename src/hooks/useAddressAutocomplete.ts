"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useNetwork } from "@/context/NetworkContext";
import { createApiClient } from "@/lib/api/client";

/** Minimum prefix length before querying (avoid overly broad searches). */
const MIN_PREFIX_LENGTH = 6;
/** Debounce delay in ms. */
const DEBOUNCE_MS = 300;

/** Regex for partial address prefixes worth autocompleting. */
const ADDRESS_PREFIX_RE = /^(bc1|tb1|[13]|[mn2])/i;

export function useAddressAutocomplete() {
  const { config } = useNetwork();
  const [suggestions, setSuggestions] = useState<string[]>([]);
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

    // Don't autocomplete txids (64 hex), xpubs, PSBTs, or short prefixes
    const trimmed = prefix.trim();
    if (
      trimmed.length < MIN_PREFIX_LENGTH ||
      /^[0-9a-f]{20,}$/i.test(trimmed) ||
      trimmed.startsWith("xpub") ||
      trimmed.startsWith("ypub") ||
      trimmed.startsWith("zpub") ||
      !ADDRESS_PREFIX_RE.test(trimmed)
    ) {
      setSuggestions([]);
      setIsOpen(false);
      return;
    }

    const seq = ++seqRef.current;

    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const client = createApiClient(config, controller.signal);
        const results = await client.getAddressPrefix(trimmed);
        // Only apply if this is still the latest request
        if (seq === seqRef.current && results.length > 0) {
          setSuggestions(results);
          setSelectedIndex(-1);
          setIsOpen(true);
        } else if (seq === seqRef.current) {
          setSuggestions([]);
          setIsOpen(false);
        }
      } catch {
        // Silently fail (endpoint unavailable, aborted, etc.)
        if (seq === seqRef.current) {
          setSuggestions([]);
          setIsOpen(false);
        }
      }
    }, DEBOUNCE_MS);
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
      return suggestions[selectedIndex];
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
