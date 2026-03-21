import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "Setup Guide | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "Setup Guide",
    "Connect your own Bitcoin node for zero third-party exposure.",
    OG_ICONS.settings,
  );
}
