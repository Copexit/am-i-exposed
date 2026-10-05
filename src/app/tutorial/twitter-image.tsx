import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "Tutorial | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "How to use am-i.exposed",
    "A 5-minute narrated walkthrough of the real tool.",
    OG_ICONS.info,
  );
}
