import entityData from "@/data/entities.json";

export type EntityCategory =
  | "exchange"
  | "darknet"
  | "scam"
  | "gambling"
  | "payment"
  | "mining"
  | "mixer"
  | "p2p";

export interface Entity {
  name: string;
  category: EntityCategory;
  status: "active" | "closed";
  country: string;
  ofac: boolean;
  priority?: number; // 1-10, default 3. Higher = more named index budget
}

/** Typed entity list (cast once to avoid repeated `as Entity[]` throughout). */
const entities: Entity[] = entityData.entities as Entity[];

/** All entities indexed by name (lowercase) for fast lookup. */
const ENTITY_MAP = new Map<string, Entity>();
for (const e of entities) {
  ENTITY_MAP.set(e.name.toLowerCase(), e);
}

/** Get an entity by exact name (case-insensitive). */
export function getEntity(name: string): Entity | undefined {
  return ENTITY_MAP.get(name.toLowerCase());
}

/** Get all entities in a given category. */
export function getEntitiesByCategory(category: EntityCategory): Entity[] {
  return entities.filter((e) => e.category === category);
}

/** Get all OFAC-sanctioned entities. */
export function getOfacEntities(): Entity[] {
  return entities.filter((e) => e.ofac);
}

/** Total entity count. */
export const ENTITY_COUNT = entities.length;

/** Category counts. */
export function getCategoryCounts(): Record<EntityCategory, number> {
  const counts = {} as Record<EntityCategory, number>;
  for (const e of entities) {
    counts[e.category] = (counts[e.category] ?? 0) + 1;
  }
  return counts;
}
