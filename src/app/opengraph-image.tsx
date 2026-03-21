import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "./og-template";

export const dynamic = "force-static";

export const alt = "am-i.exposed - Bitcoin Privacy Scanner";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "Bitcoin Privacy Scanner",
    "The Bitcoin privacy scanner you were afraid to run. 36+ heuristics.",
    OG_ICONS.eye,
  );
}
