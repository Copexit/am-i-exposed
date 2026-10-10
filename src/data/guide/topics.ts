/** Guide sections that have their own route: /guide/labeling/ and /guide/spending/. */
export type GuideTopic = "labeling" | "spending";

/** Anchor ids each topic route renders (rule items aside: labeling-rule-N, spending-rule-N). */
export const GUIDE_TOPIC_IDS: Record<GuideTopic, readonly string[]> = {
  labeling: ["labeling-coins", "labeling-sparrow"],
  spending: ["spending-checklist", "spending-ranking"],
};

/** The topic route that now holds a /guide/ anchor, else null. */
export function guideTopicFor(id: string): GuideTopic | null {
  if (GUIDE_TOPIC_IDS.labeling.includes(id) || /^labeling-rule-\d+$/.test(id)) return "labeling";
  if (GUIDE_TOPIC_IDS.spending.includes(id) || /^spending-rule-\d+$/.test(id)) return "spending";
  return null;
}
