import type { Metadata } from "next";
import { GraphPage } from "@/components/pages/GraphPage";

export const metadata: Metadata = { title: "Graph Explorer - am-i.exposed (beta)" };

export default function Page() {
  return <GraphPage />;
}
