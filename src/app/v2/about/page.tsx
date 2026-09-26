import type { Metadata } from "next";
import { AboutPage } from "@/components/pages/AboutPage";

export const metadata: Metadata = { title: "About - am-i.exposed (beta)" };

export default function Page() {
  return <AboutPage />;
}
