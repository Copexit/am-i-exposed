import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "AI Agents | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "AI Agents",
    "MCP server and CLI for automated Bitcoin privacy analysis.",
    OG_ICONS.terminal,
  );
}
