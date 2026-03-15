import { createOgImageResponse, OG_SIZE } from "../og-template";

export const dynamic = "force-static";

export const alt =
  "About - Why am-i.exposed Exists | Bitcoin Privacy Scanner";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageResponse(
    "About",
    "OXT and KYCP went offline. This tool fills the gap.",
  );
}
