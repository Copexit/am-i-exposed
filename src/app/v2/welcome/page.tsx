import type { Metadata } from "next";
import { WelcomeV2 } from "@/components/v2/pages/WelcomeV2";

export const metadata: Metadata = { title: "Why am-i.exposed Exists - am-i.exposed (beta)" };

export default function Page() {
  return <WelcomeV2 />;
}
