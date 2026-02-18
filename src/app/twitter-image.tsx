import { ImageResponse } from "next/og";

export const dynamic = "force-static";

export const alt = "am-i.exposed - Bitcoin Privacy Scanner";
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
            fontSize: 32,
            color: "#787880",
            marginTop: 8,
          }}
        >
          The Bitcoin privacy scanner you were afraid to run.
        </div>
        <div
          style={{
            fontSize: 20,
            color: "#787880",
            opacity: 0.6,
            marginTop: 16,
          }}
        >
          Free. Client-side. No tracking.
        </div>
      </div>
    ),
    { ...size },
  );
}
