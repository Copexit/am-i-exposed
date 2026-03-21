import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../og-template";

export const dynamic = "force-static";
export const alt = "Glossary | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(
    "Glossary",
    "Key terms for understanding Bitcoin on-chain privacy.",
    OG_ICONS.book,
  );
}
