import { createOgImageResponse, OG_SIZE } from "../og-template";

export const dynamic = "force-static";

export const alt = "Connect Your Node - Setup Guide | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageResponse(
    "Setup Guide",
    "Connect your Bitcoin node for maximum privacy.",
  );
}
