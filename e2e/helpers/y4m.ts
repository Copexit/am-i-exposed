import * as fs from "fs";
import QRCode from "qrcode";

const QUIET = 4;

/**
 * Write a grayscale 4:2:0 Y4M video for Chromium's fake camera
 * (`--use-file-for-fake-video-capture`): one QR per frame, each shown `repeat` times.
 */
export function writeQrVideo(path: string, frames: string[], opts: { size?: number; fps?: number; repeat?: number } = {}): void {
  const { size = 480, fps = 5, repeat = 1 } = opts;
  const chroma = Buffer.alloc((size / 2) * (size / 2) * 2, 128);
  const chunks: Buffer[] = [Buffer.from(`YUV4MPEG2 W${size} H${size} F${fps}:1 Ip A1:1 C420jpeg\n`)];
  for (const text of frames) {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "L" });
    const n = modules.size + 2 * QUIET;
    const scale = size / n;
    const y = Buffer.alloc(size * size, 255);
    for (let py = 0; py < size; py++) {
      const my = Math.floor(py / scale) - QUIET;
      if (my < 0 || my >= modules.size) continue;
      for (let px = 0; px < size; px++) {
        const mx = Math.floor(px / scale) - QUIET;
        if (mx >= 0 && mx < modules.size && modules.get(my, mx)) y[py * size + px] = 0;
      }
    }
    const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma]);
    for (let r = 0; r < repeat; r++) chunks.push(frame);
  }
  fs.writeFileSync(path, Buffer.concat(chunks));
}
