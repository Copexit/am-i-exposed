import { createOgImageWithIcon, OG_SIZE, OG_ICONS } from "../../og-template";
import { SEO_ROUTES } from "@/app/seo-routes";

const route = SEO_ROUTES.p2p;

export const dynamic = "force-static";
export const alt = `${route.name} | am-i.exposed`;
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageWithIcon(route.name, route.tagline, OG_ICONS.eye);
}
