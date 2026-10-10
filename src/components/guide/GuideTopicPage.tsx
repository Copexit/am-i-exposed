"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { KnowledgeTabBar } from "@/components/KnowledgeTabBar";
import { LabelingSection, SpendingChecklist } from "@/components/guide/LabelingSection";
import type { GuideTopic } from "@/data/guide/topics";

export function GuideTopicPage({ topic }: { topic: GuideTopic }) {
  const { t } = useTranslation();
  const labeling = topic === "labeling";
  const LINK = "text-bitcoin/80 hover:text-bitcoin transition-colors";
  return (
    <PageShell>
      <KnowledgeTabBar />
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3 text-balance">
          {labeling
            ? t("guide.topic.labeling.title", { defaultValue: "How to label bitcoin UTXOs (BIP329 and Sparrow)" })
            : t("guide.topic.spending.title", { defaultValue: "Bitcoin coin control privacy checklist" })}
        </h1>
        <p className="text-muted text-lg leading-relaxed max-w-2xl">
          {labeling
            ? t("guide.topic.labeling.intro", { defaultValue: "Label every coin by where it came from, so coins that would tie your identities together never end up in the same transaction. Origin prefixes, the rules they imply, a BIP329 example file and the steps in Sparrow." })
            : t("guide.topic.spending.intro", { defaultValue: "Which coins to spend together, when to avoid change and how payment plans are ranked: the checklist the am-i.exposed coin selector follows for every payment." })}
        </p>
      </div>

      {labeling ? <LabelingSection /> : <SpendingChecklist />}

      <nav aria-label={t("guide.topic.related", { defaultValue: "Related" })} className="flex flex-wrap gap-x-6 gap-y-2 border-t border-hairline pt-6 text-base">
        {labeling ? (
          <Link href="/guide/spending/" className={LINK}>{t("guide.toc.checklist", { defaultValue: "Spending checklist" })} &rarr;</Link>
        ) : (
          <Link href="/guide/labeling/" className={LINK}>{t("guide.toc.labeling", { defaultValue: "Labeling recommendations" })} &rarr;</Link>
        )}
        <Link href="/guide/" className={LINK}>{t("guide.topic.fullGuide", { defaultValue: "Full privacy guide" })}</Link>
      </nav>
    </PageShell>
  );
}
