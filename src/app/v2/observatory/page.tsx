import type { Metadata } from "next";
import { ObservatoryPage } from "@/components/observatory/ObservatoryPage";

export const metadata: Metadata = { title: "CoinJoin Observatory - am-i.exposed (beta)" };

export default function Page() {
  return <ObservatoryPage />;
}
