import { ImageResponse } from "next/og";
import { ogImageContent, ogImageSize } from "./opengraph-image";

export const dynamic = "force-static";

export const alt = "am-i.exposed - Bitcoin Privacy Scanner";
export const size = ogImageSize;
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(ogImageContent(), { ...size });
}
