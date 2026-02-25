import type { Grade } from "@/lib/types";

const GRADE_COLORS: Record<Grade, string> = {
  "A+": "#28d065",
  B: "#3b82f6",
  C: "#eab308",
  D: "#f97316",
  F: "#ef4444",
};

export interface ShareCardLabels {
  privacyGrade: string;
  findingsAnalyzed: string;
  footerLeft: string;
  footerRight: string;
}

export const defaultShareCardLabels: ShareCardLabels = {
  privacyGrade: "PRIVACY GRADE",
  findingsAnalyzed: "findings analyzed",
  footerLeft: "am-i.exposed - Bitcoin Privacy Scanner",
  footerRight: "Scan any address or txid at am-i.exposed",
};

export async function generateShareCard(options: {
  grade: Grade;
  score: number;
  query: string;
  inputType: "txid" | "address";
  findingCount: number;
  labels?: Partial<ShareCardLabels>;
}): Promise<Blob> {
  const labels = { ...defaultShareCardLabels, ...options.labels };
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#0c0c0e";
  ctx.fillRect(0, 0, 1200, 630);

  // Subtle grid pattern
  ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
  ctx.lineWidth = 1;
  for (let x = 0; x < 1200; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 630);
    ctx.stroke();
  }
  for (let y = 0; y < 630; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1200, y);
    ctx.stroke();
  }

  // Brand: "am-i.exposed"
  ctx.font = "bold 36px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#f0f0f2";
  ctx.fillText("am-i.", 80, 72);
  const amWidth = ctx.measureText("am-i.").width;
  ctx.fillStyle = "#ef4444";
  ctx.fillText("exposed", 80 + amWidth, 72);

  // Grade label
  ctx.font = "16px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#787880";
  ctx.fillText(labels.privacyGrade, 80, 160);

  // Grade (large)
  const gradeColor = GRADE_COLORS[options.grade] ?? "#f0f0f2";
  ctx.font = "bold 180px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = gradeColor;
  ctx.fillText(options.grade, 70, 350);

  // Score
  ctx.font = "bold 180px system-ui, -apple-system, sans-serif";
  const actualGradeWidth = ctx.measureText(options.grade).width;
  const scoreX = 90 + actualGradeWidth + 30;

  ctx.font = "bold 48px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = gradeColor;
  ctx.fillText(`${options.score}`, scoreX, 260);
  const scoreNumWidth = ctx.measureText(`${options.score}`).width;
  ctx.font = "24px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#787880";
  ctx.fillText("/100", scoreX + scoreNumWidth + 4, 260);

  // Finding count
  ctx.font = "20px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#787880";
  ctx.fillText(`${options.findingCount} ${labels.findingsAnalyzed}`, scoreX, 300);

  // Severity bar
  const barX = scoreX;
  const barY = 320;
  const barWidth = 300;
  const barHeight = 8;
  ctx.fillStyle = "#1a1a1e";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barWidth, barHeight, 4);
  ctx.fill();
  const fillWidth = (options.score / 100) * barWidth;
  ctx.fillStyle = gradeColor;
  ctx.beginPath();
  ctx.roundRect(barX, barY, fillWidth, barHeight, 4);
  ctx.fill();

  // Query (truncated)
  ctx.font = "16px monospace";
  ctx.fillStyle = "#505058";
  const label = options.inputType === "txid" ? "TX" : "ADDR";
  const truncated =
    options.query.length > 48
      ? options.query.slice(0, 24) + "..." + options.query.slice(-12)
      : options.query;
  ctx.fillText(`${label}: ${truncated}`, 80, 440);

  // Bottom divider
  ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
  ctx.fillRect(80, 520, 1040, 1);

  // Footer
  ctx.font = "16px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = "#505058";
  ctx.fillText(labels.footerLeft, 80, 570);

  ctx.fillStyle = "#505058";
  ctx.textAlign = "right";
  ctx.fillText(labels.footerRight, 1120, 570);
  ctx.textAlign = "left";

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), "image/png");
  });
}
