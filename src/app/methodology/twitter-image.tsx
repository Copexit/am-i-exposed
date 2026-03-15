import { createOgImageResponse, OG_SIZE } from "../og-template";

export const dynamic = "force-static";

export const alt =
  "Methodology - How Bitcoin Privacy is Scored | am-i.exposed";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return createOgImageResponse(
    "Methodology",
    "30 heuristics. Scoring model. Threat model. All documented.",
  );
}
