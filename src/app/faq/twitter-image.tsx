import { createOgImageResponse, OG_SIZE } from "../og-template";

export const dynamic = "force-static";

export const alt =
  "FAQ - Bitcoin Privacy Questions Answered | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageResponse(
    "FAQ",
    "Bitcoin privacy questions answered. 13 common questions.",
  );
}
