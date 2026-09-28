import type { Metadata } from "next";
import { BreadcrumbJsonLd } from "@/components/BreadcrumbJsonLd";

export const metadata: Metadata = {
  title: "Agent Integration - CLI and MCP Server | am-i.exposed",
  description:
    "Run am-i.exposed from the command line or as an MCP server: Bitcoin privacy scans for AI agents and scripts, with JSON output.",
  keywords: [
    "bitcoin privacy cli",
    "bitcoin mcp server",
    "ai agent bitcoin privacy",
    "am-i-exposed npx",
  ],
  alternates: {
    canonical: "https://am-i.exposed/agents/",
  },
  openGraph: {
    title: "Agent Integration | am-i.exposed",
    description:
      "Run am-i.exposed from the command line or as an MCP server: Bitcoin privacy scans for AI agents and scripts, with JSON output.",
    url: "https://am-i.exposed/agents/",
    type: "article",
    siteName: "am-i.exposed",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Integration | am-i.exposed",
    description:
      "Run am-i.exposed from the command line or as an MCP server: Bitcoin privacy scans for AI agents and scripts, with JSON output.",
  },
};

export default function AgentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <BreadcrumbJsonLd name="Agents" path="/agents/" />
      {children}
    </>
  );
}
