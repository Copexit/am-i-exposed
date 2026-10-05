import type { NextConfig } from "next";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf-8")) as { version: string };

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // next dev would otherwise append generated agent rules to CLAUDE.md on every run
  agentRules: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    // always defined, so VIDEOS_ENABLED folds to a constant and flag-off bundles drop the video code
    NEXT_PUBLIC_VIDEOS: process.env.NEXT_PUBLIC_VIDEOS ?? "",
  },
};

export default nextConfig;
