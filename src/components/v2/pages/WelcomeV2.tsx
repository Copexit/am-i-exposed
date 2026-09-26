"use client";

import { useTranslation } from "react-i18next";
import { WelcomePage } from "@/components/pages/WelcomePage";
import { V2PageFrame } from "./V2PageFrame";

/** Welcome manifesto in the v2 frame (the classic page has no title of its own). */
export function WelcomeV2() {
  const { t } = useTranslation();
  return (
    <V2PageFrame title={t("v2.pages.welcomeTitle", { defaultValue: "Why am-i.exposed exists" })}>
      <WelcomePage />
    </V2PageFrame>
  );
}
