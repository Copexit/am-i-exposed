import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "CoinJoin Observatory | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "CoinJoin Observatory",
    "Live Whirlpool and WabiSabi stats, sourced from independent projects.",
    OG_ICONS.network,
  );
}
