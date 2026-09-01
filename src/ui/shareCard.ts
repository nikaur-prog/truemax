import type { Report } from "../engine/types.js";
import { exportName } from "./saveFile.js";

// Shareable result card. This is the distribution mechanic: a screenshot
// people post without being asked. Rendered to canvas so it can be saved or
// handed to the native share sheet, and deliberately dark so it stands out in
// a feed against the app's light UI.

const W = 1080;
const H = 1350; // 4:5, the aspect that survives Instagram and TikTok crops

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function scoreColor(score: number): string {
  return score >= 6 ? "#4FD1B0" : score >= 4.5 ? "#E8CB84" : "#D6907C";
}

function shareRank(percentile: number): string {
  const high = percentile >= 50;
  const tail = high ? 100 - percentile : percentile;
  return `${high ? "TOP" : "BOTTOM"} ${Math.max(.1, Math.round(tail * 10) / 10)}%`;
}

export async function renderShareCard(
  report: Report,
  photo: HTMLCanvasElement,
): Promise<HTMLCanvasElement> {
  // Canvas text does not trigger a webfont load and does not wait for one. The
  // page fonts are already in use by the time anyone can press Share, but this
  // is the one artefact that leaves the device — it is not allowed to go out
  // set in Georgia because of a race.
  await document.fonts.ready;

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;

  ctx.fillStyle = "#141518";
  ctx.fillRect(0, 0, W, H);

  // Wordmark
  ctx.fillStyle = "#8B8E94";
  ctx.font = '600 26px Inter Variable, Inter, system-ui, sans-serif';
  ctx.textAlign = "left";
  ctx.letterSpacing = "6px";
  ctx.fillText("TRUE", 80, 108);
  const tw = ctx.measureText("TRUE").width;
  ctx.fillStyle = "#4FD1B0";
  ctx.fillText("MAX", 80 + tw, 108);
  ctx.letterSpacing = "0px";

  ctx.fillStyle = "#6B6E74";
  ctx.font = '500 22px Inter Variable, Inter, system-ui, sans-serif';
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }), W - 80, 108);

  // Face, circular
  const r = 164;
  const cx = W / 2;
  const cy = 315;
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

  // Overall score — the share headline, followed by all three view scores so
  // the card that leaves the app carries the same full result the report does.
  ctx.textAlign = "center";
  ctx.fillStyle = "#F4F3EF";
  ctx.font = '300 142px Fraunces Variable, Fraunces, Georgia, serif';
  ctx.fillText(report.overall.toFixed(1), cx, 620);
  ctx.fillStyle = "#6B6E74";
  ctx.font = '400 34px Fraunces Variable, Fraunces, Georgia, serif';
  ctx.fillText("/10", cx + 126, 620);

  ctx.fillStyle = "#4FD1B0";
  ctx.font = '600 23px Inter Variable, Inter, system-ui, sans-serif';
  ctx.fillText(
    `${shareRank(report.overallPercentile)}  ·  ${report.sex.toUpperCase()} NORMS`,
    cx,
    668,
  );

  const viewEntries = report.views
    ? [
        { label: "OVERALL", score: report.overall, percentile: report.overallPercentile },
        { label: "FRONT", score: report.views.front.score, percentile: report.views.front.percentile },
        { label: "SIDE", score: report.views.side.score, percentile: report.views.side.percentile },
      ]
    : [{ label: "OVERALL", score: report.overall, percentile: report.overallPercentile }];
  const viewGap = 22;
  const viewWidth = viewEntries.length === 3 ? 292 : 360;
  const viewStart = (W - (viewEntries.length * viewWidth + (viewEntries.length - 1) * viewGap)) / 2;
  viewEntries.forEach((entry, index) => {
    const x = viewStart + index * (viewWidth + viewGap);
    const y = 728;
    roundedRect(ctx, x, y, viewWidth, 144, 20);
    ctx.fillStyle = entry.label === "OVERALL" ? "#20332F" : "#1B1D20";
    ctx.fill();
    ctx.strokeStyle = entry.label === "OVERALL" ? "rgba(79,209,176,.42)" : "rgba(255,255,255,.10)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = entry.label === "OVERALL" ? "#8FE3CE" : "#8B8E94";
    ctx.font = '600 18px Inter Variable, Inter, system-ui, sans-serif';
    ctx.letterSpacing = "3px";
    ctx.fillText(entry.label, x + viewWidth / 2, y + 34);
    ctx.letterSpacing = "0px";
    ctx.fillStyle = scoreColor(entry.score);
    ctx.font = '400 54px Fraunces Variable, Fraunces, Georgia, serif';
    ctx.fillText(entry.score.toFixed(1), x + viewWidth / 2, y + 91);
    ctx.fillStyle = "#6B6E74";
    ctx.font = '500 16px Inter Variable, Inter, system-ui, sans-serif';
    ctx.fillText(shareRank(entry.percentile), x + viewWidth / 2, y + 121);
  });

  // Pillars, 2x2
  const entries = Object.entries(report.pillars) as [string, number][];
  const gx = [W / 2 - 200, W / 2 + 200];
  const gy = [1010, 1140];
  entries.forEach(([name, score], i) => {
    const x = gx[i % 2];
    const y = gy[Math.floor(i / 2)];
    ctx.fillStyle = scoreColor(score);
    ctx.font = '400 60px Fraunces Variable, Fraunces, Georgia, serif';
    ctx.fillText(score.toFixed(1), x, y);
    ctx.fillStyle = "#6B6E74";
    ctx.font = '600 20px Inter Variable, Inter, system-ui, sans-serif';
    ctx.letterSpacing = "3px";
    ctx.fillText(name.toUpperCase(), x, y + 34);
    ctx.letterSpacing = "0px";
  });

  ctx.fillStyle = "#4A4C51";
  ctx.font = '500 22px Inter Variable, Inter, system-ui, sans-serif';
  ctx.fillText("FULL FACE REPORT  ·  TRUEMAX.APP", cx, H - 62);

  return c;
}

export function downloadCard(canvas: HTMLCanvasElement): void {
  const link = document.createElement("a");
  link.download = exportName("card", "png");
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
