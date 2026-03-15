import { createOgImageResponse, OG_SIZE } from "../og-template";

export const dynamic = "force-static";

export const alt =
  "Bitcoin Privacy Glossary | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageResponse(
    "Glossary",
    "30+ Bitcoin privacy terms explained.",
  );
}
