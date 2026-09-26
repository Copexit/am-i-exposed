import type { Metadata } from "next";
import { FaqPage } from "@/components/pages/FaqPage";

export const metadata: Metadata = { title: "FAQ - am-i.exposed (beta)" };

export default function Page() {
  return <FaqPage />;
}
