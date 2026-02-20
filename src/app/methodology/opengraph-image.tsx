import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export const alt =
  "Methodology - How Bitcoin Privacy is Scored | am-i.exposed";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0a0a0a",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              fontSize: 96,
              fontWeight: 700,
              color: "#ededed",
              letterSpacing: "-0.02em",
            }}
          >
            am-i.
          </span>
          <span
            style={{
              fontSize: 96,
              fontWeight: 700,
              color: "#ef4444",
              letterSpacing: "-0.02em",
            }}
          >
            exposed
          </span>
        </div>
        <div
          style={{
            fontSize: 40,
            fontWeight: 600,
            color: "#f0f0f2",
            marginTop: 8,
          }}
        >
          Methodology
        </div>
        <div
          style={{
            fontSize: 22,
            color: "#787880",
            marginTop: 16,
          }}
        >
          16 heuristics. Scoring model. Threat model. All documented.
        </div>
      </div>
    ),
    { ...size },
  );
}
