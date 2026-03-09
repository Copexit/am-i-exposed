/**
 * OSINT (Open Source Intelligence) source tracking types.
 *
 * These types model the provenance of entity/address labels - where the
 * information linking a Bitcoin address to a real-world entity came from.
 *
 * Privacy consideration: OSINT lookups should NEVER be performed for the
 * user's own addresses. These types are for pre-curated, static data only.
 */

export type OsintSourceType =
  | "government"    // OFAC SDN list, DOJ seizure notices, court filings
  | "law-enforcement" // FBI, Europol, police reports
  | "blog"          // Research blogs (Chainalysis, OXT, etc.)
  | "social-media"  // Twitter/X, Reddit, forum posts
  | "news"          // News articles, press releases
  | "academic"      // Research papers, academic publications
  | "exchange"      // Exchange-published address lists
  | "community";    // CryptoScamDB, WalletExplorer, community tagging

export interface OsintSource {
  /** URL of the source (tweet, article, report, etc.) */
  url: string;
  /** Bitcoin address or cluster identifier referenced */
  address: string;
  /** Entity name the source links to */
  entityName: string;
  /** Date the source was published or discovered (ISO 8601) */
  date: string;
  /** Type of source */
  sourceType: OsintSourceType;
  /** Brief description of what the source claims */
  description?: string;
}

/**
 * Entities.json already provides name, category, status, country, ofac.
 * OSINT sources add provenance - WHY do we believe an address belongs
 * to an entity? This data can be used to verify address labels against
 * public evidence and assess label confidence.
 */
export interface EntitySourceBundle {
  /** Entity name (matches entities.json) */
  entityName: string;
  /** All OSINT sources that link addresses to this entity */
  sources: OsintSource[];
  /** Addresses confirmed by multiple independent sources */
  highConfidenceAddresses: string[];
  /** Addresses from a single source (lower confidence) */
  mediumConfidenceAddresses: string[];
}
