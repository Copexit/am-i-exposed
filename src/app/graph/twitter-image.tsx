import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "Graph Explorer | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "Graph Explorer",
    "Interactive Bitcoin transaction graph. Trace inputs, outputs, and fund flows.",
    OG_ICONS.network,
  );
}
