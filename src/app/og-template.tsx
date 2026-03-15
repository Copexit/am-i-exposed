import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * Shared OG/Twitter image generator for subpages.
 * Renders the am-i.exposed branding with a title and subtitle line.
 */
export function createOgImageResponse(title: string, subtitle: string): ImageResponse {
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
          {title}
        </div>
        <div
          style={{
            fontSize: 22,
            color: "#787880",
            marginTop: 16,
          }}
        >
          {subtitle}
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
