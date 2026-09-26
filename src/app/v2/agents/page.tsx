import type { Metadata } from "next";
import { AgentsPage } from "@/components/pages/AgentsPage";

export const metadata: Metadata = { title: "Agent Integration - am-i.exposed (beta)" };

export default function Page() {
  return <AgentsPage />;
}
