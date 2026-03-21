import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "Privacy Guide | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "Privacy Guide",
    "Techniques, tools, and best practices for Bitcoin privacy.",
    OG_ICONS.shield,
  );
}
