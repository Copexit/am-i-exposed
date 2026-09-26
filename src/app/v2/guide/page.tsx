import type { Metadata } from "next";
import { GuidePage } from "@/components/guide/GuidePage";

export const metadata: Metadata = { title: "Bitcoin Privacy Guide - am-i.exposed (beta)" };

export default function Page() {
  return <GuidePage />;
}
