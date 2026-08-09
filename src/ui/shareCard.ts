import type { Report } from "../engine/types.ts";

// Shareable result card. This is the distribution mechanic: a screenshot
// people post without being asked. Rendered to canvas so it can be saved or
// handed to the native share sheet, and deliberately dark so it stands out in
// a feed against the app's light UI.

const W = 1080;
const H = 1350; // 4:5, the aspect that survives Instagram and TikTok crops

export async function renderShareCard(
  report: Report,
  photo: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = "#141518";
  ctx.fillRect(0, 0, W, H);

  // Wordmark
  ctx.fillStyle = "#8B8E94";
  ctx.font = '500 26px "IBM Plex Mono", monospace';
  ctx.textAlign = "left";
  ctx.letterSpacing = "6px";
  ctx.fillText("TRUE", 80, 108);
  const tw = ctx.measureText("TRUE").width;
  ctx.fillStyle = "#4FD1B0";
  ctx.fillText("MAX", 80 + tw, 108);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#6B6E74";
  ctx.font = '400 22px "IBM Plex Mono", monospace';
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), W - 80, 108);

  // Face, circular
  const r = 210;
  const cx = W / 2;
  const cy = 430;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const scale = Math.max((r * 2) / photo.width, (r * 2) / photo.height);
  const dw = photo.width * scale;
  const dh = photo.height * scale;
  ctx.drawImage(photo, cx - dw / 2, cy - dh / 2, dw, dh);
  ctx.restore();
  ctx.strokeStyle = "rgba(143,243,224,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Overall score
  ctx.textAlign = "center";
  ctx.fillStyle = "#F4F3EF";
  ctx.font = '300 168px Fraunces, Georgia, serif';
  ctx.fillText(report.overall.toFixed(1), cx, 800);
  ctx.fillStyle = "#6B6E74";
  ctx.font = '400 40px Fraunces, Georgia, serif';
  ctx.fillText("/10", cx + 150, 800);

  ctx.fillStyle = "#4FD1B0";
  ctx.font = '500 26px "IBM Plex Mono", monospace';
  ctx.fillText(
    `TOP ${Math.max(0.1, Math.round((100 - report.overallPercentile) * 10) / 10)}%  ·  ${report.sex.toUpperCase()} NORMS`,
    cx,
    852,
  );

  // Pillars, 2x2
  const entries = Object.entries(report.pillars) as [string, number][];
  const gx = [W / 2 - 200, W / 2 + 200];
  const gy = [990, 1130];
  entries.forEach(([name, score], i) => {
    const x = gx[i % 2];
    const y = gy[Math.floor(i / 2)];
    ctx.fillStyle = score >= 6 ? "#4FD1B0" : score >= 4.5 ? "#E8CB84" : "#D6907C";
    ctx.font = '400 60px Fraunces, Georgia, serif';
    ctx.fillText(score.toFixed(1), x, y);
    ctx.fillStyle = "#6B6E74";
    ctx.font = '500 20px "IBM Plex Mono", monospace';
    ctx.letterSpacing = "3px";
    ctx.fillText(name.toUpperCase(), x, y + 34);
    ctx.letterSpacing = "0px";
  });

  ctx.fillStyle = "#4A4C51";
  ctx.font = '400 22px "IBM Plex Mono", monospace';
  ctx.fillText("MEASURED ON-DEVICE  ·  TRUEMAX.APP", cx, H - 70);

  return c;
}

export function downloadCard(canvas: HTMLCanvasElement): void {
  const link = document.createElement("a");
  link.download = `truemax-${Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

// Native share sheet where available (mobile), download everywhere else.
export async function shareCard(canvas: HTMLCanvasElement, score: number): Promise<void> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) return;
  const file = new File([blob], "truemax.png", { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `I scored ${score.toFixed(1)}/10 on TrueMax.` });
      return;
    } catch {
      /* user dismissed — fall through to download */
    }
  }
  downloadCard(canvas);
}
