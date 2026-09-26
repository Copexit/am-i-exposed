import type { Metadata } from "next";
import { SetupGuidePage } from "@/components/pages/SetupGuidePage";

export const metadata: Metadata = { title: "Connect Your Node - am-i.exposed (beta)" };

export default function Page() {
  return <SetupGuidePage />;
}
