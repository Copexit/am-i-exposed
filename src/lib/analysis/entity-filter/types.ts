import type { EntityCategory } from "../entities";

/** Result of checking an address against the entity filter. */
export interface EntityMatch {
  /** The matched address */
  address: string;
  /** Entity name (from metadata DB lookup after filter match) */
  entityName: string;
  /** Entity category */
  category: EntityCategory;
  /** Whether this entity is OFAC-sanctioned */
  ofac: boolean;
  /** Confidence level: "high" for exact match, "medium" for filter match */
  confidence: "high" | "medium";
}

/** Metadata about the loaded filter. */
export interface FilterMeta {
  /** When the filter data was last built */
  buildDate: string;
  /** Number of addresses in the filter */
  addressCount: number;
  /** Filter format version */
  version: number;
  /** False positive rate (e.g. 0.001 for 0.1%) */
  fpr: number;
}

/** Interface for address filter implementations (XOR, Bloom, or Set). */
export interface AddressFilter {
  /** Check if an address might be in the known entity set. */
  has(address: string): boolean;
  /** Filter metadata. */
  meta: FilterMeta;
}

/** Status of the lazy-loaded filter. */
export type FilterStatus = "idle" | "loading" | "ready" | "error" | "unavailable";
