/**
 * Entity name search for autocomplete.
 * Performs case-insensitive prefix matching against known entity names,
 * returning sample addresses that can be scanned.
 */

import entityData from "@/data/entities.json";
import type { EntityCategory } from "@/lib/analysis/entities";

export interface EntitySuggestion {
  entityName: string;
  category: EntityCategory;
  address: string;
}

interface EntityEntry {
  name: string;
  nameLower: string;
  category: EntityCategory;
  priority: number;
  addresses: string[];
}

/** Pre-sorted entity list: priority desc, then alphabetical. */
const ENTITY_LIST: EntityEntry[] = (entityData.entities as Array<{
  name: string;
  category: string;
  priority?: number;
  sampleAddresses?: string[];
}>)
  .filter((e) => e.sampleAddresses && e.sampleAddresses.length > 0)
  .map((e) => ({
    name: e.name,
    nameLower: e.name.toLowerCase(),
    category: e.category as EntityCategory,
    priority: e.priority ?? 3,
    addresses: e.sampleAddresses!,
  }))
  .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));

/**
 * Search entities by name prefix. Returns up to `limit` suggestions.
 * Each matched entity contributes up to 2 address suggestions.
 * Minimum query length: 2 characters.
 */
export function searchEntitiesByPrefix(
  query: string,
  limit = 10,
): EntitySuggestion[] {
  if (query.length < 2) return [];

  const q = query.toLowerCase();
  const results: EntitySuggestion[] = [];

  for (const entry of ENTITY_LIST) {
    if (results.length >= limit) break;

    if (!entry.nameLower.startsWith(q)) continue;

    // Up to 2 addresses per entity to keep dropdown manageable
    const maxAddrs = Math.min(2, entry.addresses.length, limit - results.length);
    for (let i = 0; i < maxAddrs; i++) {
      results.push({
        entityName: entry.name,
        category: entry.category,
        address: entry.addresses[i],
      });
    }
  }

  return results;
}
