import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "Welcome | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "Welcome",
    "Bitcoin privacy scanner. Free, client-side, no tracking.",
    OG_ICONS.sparkle,
  );
}
