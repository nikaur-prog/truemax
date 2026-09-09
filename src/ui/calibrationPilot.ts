import { initLandmarker, setRunningMode } from "../engine/landmarker.js";
import { detectStable } from "../engine/consensus.js";
import { buildGeometry, landmarkIntegrityIssues } from "../engine/geometry.js";
import { computeRawMetrics } from "../engine/metrics.js";
import { analyze, analyzeSide } from "../engine/scoring.js";
import { assessQuality } from "../engine/quality.js";
import { findHairline } from "../engine/hairline.js";
import { detectHeadCovering, warmHeadCovering } from "../engine/headCovering.js";
import { computeSideMetrics, faceDirFromPoints, SIDE_POINTS, sidePointIntegrityIssues } from "../engine/sideMetrics.js";
import { classifySidePlacement } from "../engine/sidePlacementQuality.js";
import { setSidePriorSuspended } from "../engine/sidePrior.js";
import { seedSidePointsSmart } from "./sideVerify.js";
import { PILOT_SOURCES } from "./calibrationPilotSources.js";
import { PILOT_MAX_IMAGE_DIM, PILOT_NOTICE, PILOT_SCHEMA_VERSION, pilotJson, pilotManifest, pilotPairs, pilotReferenceSnapshot, pilotReportSnapshot } from "./calibrationPilotData.js";
import { finishPilotRecords, sharePilotStartup, waitForPilotStage } from "./calibrationPilotLifecycle.js";
import type { PilotRecord } from "./calibrationPilotData.js";
import type { Report } from "../engine/types.js";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const number = (value: number | undefined, digits = 3) => Number.isFinite(value) ? value!.toFixed(digits) : "unavailable";
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const detectorStartup = sharePilotStartup(async () => {
  await initLandmarker();
  await setRunningMode("IMAGE");
});

async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function provenance(signal: AbortSignal) {
  const sources = await Promise.all(Object.entries(PILOT_SOURCES).map(async ([path, source]) => ({
    path, sha256: await sha256(new TextEncoder().encode(source).buffer), source,
  })));
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  // These are the same same-origin assets used by the on-device engines.
  // Fetching their bytes hashes the local runtime, never sends a photograph.
  const assets = await Promise.all(["/models/face_landmarker.task", "/models/selfie_multiclass_256x256.tflite"].map(async (path) => {
    try {
      const response = await fetch(path, { credentials: "omit", signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      return { path, bytes: bytes.byteLength, sha256: await sha256(bytes), failure: null };
    } catch (error) {
      if (signal.aborted) throw error;
      return { path, bytes: null, sha256: null, failure: message(error) };
    }
  }));
  return { sources, assets };
}

async function decode(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, PILOT_MAX_IMAGE_DIM / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = element("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { canvas, nativeWidth: image.naturalWidth, nativeHeight: image.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

async function measure(record: PilotRecord, canvas: HTMLCanvasElement, signal: AbortSignal): Promise<Report> {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  const { width, height } = canvas;
  if (record.view === "front") {
    const detection = detectStable(canvas);
    const landmarks = detection.faceLandmarks[0] ?? [];
    const quality = assessQuality(detection);
    record.diagnostics = { quality, inference: "Production detectStable; consensus may fall back to the single base detection", automaticPointsVerified: false };
    record.warnings.push(...quality.issues);
    const integrity = landmarkIntegrityIssues(landmarks);
    // Preserve even partial failed detections instead of losing their evidence.
    record.points = landmarks.map((p, i) => ({ id: String(i), x: p.x * width, y: p.y * height, normalizedX: p.x, normalizedY: p.y, z: p.z }));
    if (integrity.length) throw new Error(integrity.join("; "));
    const geometry = buildGeometry(landmarks, width, height);
    record.points.forEach((point, i) => { point.corrected = geometry.pt(i); });
    record.rawMeasurements = computeRawMetrics(geometry);
    const hairline = findHairline(canvas, landmarks, width, height);
    if (hairline) record.rawMeasurements.foreheadRatio = hairline.foreheadRatio;
    record.diagnostics.geometryPose = { yawDeg: geometry.yawDeg, pitchDeg: geometry.pitchDeg, rollDeg: geometry.rollDeg, imageRollDeg: geometry.imageRollDeg };
    record.diagnostics.pixelHairline = hairline ?? { available: false, reason: "Pixel hairline refused or unavailable; not imputed" };
    const report = analyze(landmarks, width, height, record.sex, canvas);
    for (const m of report.metrics) record.rawMeasurements[m.def.id] = m.value;
    return report;
  }

  const segmentationProbe = await detectHeadCovering(canvas, { signal });
  if (!segmentationProbe.available) record.warnings.push("Optional segmentation unavailable; the device seeder may use its fallback");
  const seed = await seedSidePointsSmart(canvas, (points, faceDir) => {
    // Same candidate acceptance as sideFlow.seedAssessment: a non-measurable
    // candidate is not vetoed here, but the final integrity guard still fails.
    try {
      const assessment = classifySidePlacement(analyzeSide(points, faceDir, record.sex).metrics);
      return assessment.hard.length === 0 && assessment.marginal.length === 0;
    } catch { return true; }
  }, signal);
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
  record.points = SIDE_POINTS.map(({ id, label }) => ({ id, label, ...seed.points[id], normalizedX: seed.points[id].x / width, normalizedY: seed.points[id].y / height }));
  const faceDir = faceDirFromPoints(seed.points);
  const integrity = sidePointIntegrityIssues(seed.points, width, height, faceDir);
  record.diagnostics = { method: seed.method, seedConfidence: seed.confidence, seedFaceDir: seed.faceDir, measuredFaceDir: faceDir,
    segmentationProbe, integrity, automaticPointsVerified: false, ownerPriorUsed: false,
    construction: "Photographic surface points. Gonial angle uses jaw corner, surface jaw hinge and chin bottom, not an X-ray skeletal angle. The existing skeletal-derived scoring reference is not validated for this construction." };
  // Capture raw constructions even if a final integrity guard refuses scoring.
  record.rawMeasurements = computeSideMetrics(seed.points, faceDir);
  if (integrity.length) throw new Error(integrity.join("; "));
  const report = analyzeSide(seed.points, faceDir, record.sex);
  const placement = classifySidePlacement(report.metrics);
  record.diagnostics.placementQuality = { hard: placement.hard.map((m) => m.def.id), marginal: placement.marginal.map((m) => m.def.id) };
  for (const metric of [...placement.hard, ...placement.marginal]) record.warnings.push(`${metric.def.name}: automatic placement needs review; metric excluded from aggregates`);
  record.warnings.push("Profile seed has not been human-verified; a produced score does not confirm correct point placement");
  return report;
}

function preview(canvas: HTMLCanvasElement, record: PilotRecord): HTMLCanvasElement {
  const thumbnail = element("canvas");
  const scale = Math.min(1, 420 / canvas.width, 500 / canvas.height);
  thumbnail.width = Math.round(canvas.width * scale);
  thumbnail.height = Math.round(canvas.height * scale);
  const context = thumbnail.getContext("2d")!;
  context.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  context.font = "11px sans-serif";
  for (const point of record.points ?? []) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const x = point.x * scale, y = point.y * scale;
    context.beginPath(); context.arc(x, y, record.view === "side" ? 3 : 1, 0, Math.PI * 2);
    context.fillStyle = "#42ffe1"; context.fill();
    if (record.view === "side") {
      context.lineWidth = 3; context.strokeStyle = "#08121e"; context.strokeText(point.label ?? point.id, x + 5, y - 5);
      context.fillStyle = "#ffffff"; context.fillText(point.label ?? point.id, x + 5, y - 5);
    }
  }
  return thumbnail;
}

function recordDetail(record: PilotRecord, thumbnail?: HTMLCanvasElement): HTMLDetailsElement {
  const detail = element("details");
  detail.append(element("summary", `${record.key}: ${record.status}${record.report ? `, overall ${number(record.report.overall, 1)}` : ""}`));
  if (thumbnail) detail.append(thumbnail);
  if (record.failure) detail.append(element("p", `Failure: ${record.failure}`));
  for (const warning of record.warnings) detail.append(element("p", warning));
  if (record.report) {
    const table = element("table");
    const header = element("tr");
    for (const text of ["Metric", "Value", "Score / 10", "Conformance", "Ideal display range", "Reference mean / SD", "Status"]) header.append(element("th", text));
    table.append(header);
    for (const m of record.report.metrics) {
      const row = element("tr");
      const values = [m.def.name, `${number(m.value, m.def.decimals)} ${m.def.unit}`, number(m.score, 1), number(m.conformance),
        m.idealRange.map((n) => number(n)).join(" to "), `${number(m.selectedReference.mean)} / ${number(m.selectedReference.sd)}`, m.measurementStatus];
      values.forEach((text) => row.append(element("td", text))); table.append(row);
    }
    detail.append(table);
  }
  const raw = element("details"); raw.append(element("summary", "All points, raw measurements and diagnostics"), element("pre", pilotJson(record)));
  detail.append(raw);
  return detail;
}

export function mountCalibrationPilot(root: HTMLElement): void {
  if (!import.meta.env.DEV) throw new Error("Calibration pilot is development-only");
  const style = element("style");
  style.textContent = `body{margin:0;background:#101821;color:#eaf0f5;font:15px/1.5 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:28px}h1{font-size:28px}button,input{font:inherit;margin:6px 10px 6px 0;padding:9px}button{cursor:pointer}button:disabled{cursor:default}table{width:100%;border-collapse:collapse;margin:14px 0;font-size:13px}td,th{text-align:left;padding:8px;border-bottom:1px solid #334555}details{border:1px solid #334555;border-radius:8px;margin:10px 0;padding:12px;overflow:auto}summary{cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:600px;overflow:auto;font-size:12px}canvas{max-width:100%;height:auto}p{max-width:1000px}.pilot-status{color:#89e9d6}`;
  document.head.append(style);
  root.replaceChildren(element("h1", "TrueMax local calibration pilot"), element("p", PILOT_NOTICE),
    element("p", "Choose the 40 local files named f01-front.png, f01-side.png through f10, and m01 through m10. Partial sets are allowed and missing views stay visible. Sex is the declared filename stratum. The app does not infer age, sex, identity consistency or human attractiveness from these images."),
    element("p", "Local processing only: no account, API, cloud placement, photo upload or history storage. Same-origin detector assets are loaded by the development server. Front analysis uses production consensus and scoring; profiles use production device seeding without an owner prior. Capture eligibility and human verification are not bypassed claims of validity."));
  const input = element("input"); input.type = "file"; input.multiple = true; input.accept = "image/png,image/jpeg,image/webp"; input.setAttribute("aria-label", "Choose pilot images");
  const run = element("button", "Run local diagnostic"); run.disabled = true;
  const cancel = element("button", "Cancel after current inference"); cancel.disabled = true;
  const download = element("button", "Export JSON"); download.disabled = true;
  const status = element("p", "No files chosen"); status.className = "pilot-status"; status.setAttribute("role", "status");
  const manifestNode = element("div"); const pairNode = element("div"); const resultsNode = element("div");
  root.append(input, run, cancel, download, status, manifestNode, pairNode, resultsNode);
  let manifest = pilotManifest<File>([]);
  let records: PilotRecord[] = [];
  let reports = new Map<string, Report>();
  let controller: AbortController | null = null;
  let startedAt: string | null = null, completedAt: string | null = null;
  let sources: Awaited<ReturnType<typeof provenance>> | null = null;
  let runFailure: string | null = null;
  const exportData = () => ({ schemaVersion: PILOT_SCHEMA_VERSION, notice: PILOT_NOTICE, build: __BUILD__, startedAt, completedAt,
    runtime: { userAgent: navigator.userAgent, maxImageDimension: PILOT_MAX_IMAGE_DIM, localOnly: true, ownerPriorUsed: false, automaticPointsVerified: false, humanRatings: null, normFittingPerformed: false },
    runFailure, references: pilotReferenceSnapshot(), provenance: sources, rejectedFiles: manifest.rejected, records, pairs: pilotPairs(records, reports) });

  function paintPairs() {
    pairNode.replaceChildren(element("h2", "Declared pairs"));
    const table = element("table"); const heading = element("tr");
    ["Person", "Front", "Side", "Merged diagnostic score", "Status"].forEach((text) => heading.append(element("th", text))); table.append(heading);
    for (const pair of pilotPairs(records, reports)) {
      const row = element("tr");
      [pair.personId, pair.frontStatus, pair.sideStatus, pair.report ? number(pair.report.overall, 1) : "unavailable", pair.status].forEach((text) => row.append(element("td", text)));
      table.append(row);
    }
    pairNode.append(table);
  }
  function reset() {
    manifest = pilotManifest(Array.from(input.files ?? []));
    records = manifest.slots.map(({ file: _file, ...slot }) => ({ ...slot, failure: slot.status === "missing" ? "File not supplied" : slot.status === "duplicate" ? "Multiple files map to this view; none was selected" : null, warnings: [] }));
    reports = new Map(); startedAt = completedAt = null; sources = null; runFailure = null;
    manifestNode.replaceChildren(element("p", `${manifest.slots.filter((s) => s.status === "queued").length} ready; ${records.filter((r) => r.status === "missing").length} missing; ${records.filter((r) => r.status === "duplicate").length} duplicate slots; ${manifest.rejected.length} rejected filenames`));
    manifest.rejected.forEach((file) => manifestNode.append(element("p", `${file.filename}: ${file.reason}`)));
    resultsNode.replaceChildren(); paintPairs();
    run.disabled = !manifest.slots.some((s) => s.status === "queued"); download.disabled = records.length === 0;
  }
  input.addEventListener("change", () => { reset(); status.textContent = "Files selected. Nothing has been analyzed or uploaded."; });
  cancel.addEventListener("click", () => { controller?.abort(); status.textContent = "Cancelling after the current on-device inference"; });
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([pilotJson(exportData())], { type: "application/json" }));
    const link = element("a"); link.href = url; link.download = `truemax-local-pilot-${(startedAt ?? new Date().toISOString()).replace(/[:.]/g, "-")}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  run.addEventListener("click", () => void (async () => {
    reset(); startedAt = new Date().toISOString(); controller = new AbortController();
    const signal = controller.signal;
    run.disabled = true; input.disabled = true; cancel.disabled = false; download.disabled = true;
    status.textContent = "Preparing local detector assets and source provenance";
    // This standalone entry is the sole owner of the freshly initialized
    // sidePrior module. Restore its initial false state even on abort/error.
    setSidePriorSuspended(true);
    try {
      sources = await waitForPilotStage("Source and asset provenance", provenance, signal);
      await waitForPilotStage("Face detector startup", detectorStartup, signal);
      await waitForPilotStage("Optional segmentation startup", () => warmHeadCovering(), signal);
      for (let i = 0; i < records.length; i++) {
        if (signal.aborted) break;
        const record = records[i], file = manifest.slots[i].file;
        if (!file) continue;
        record.status = "processing"; status.textContent = `Measuring ${record.key} locally`; paintPairs(); await pause();
        let canvas: HTMLCanvasElement | undefined;
        try {
          const decoded = await waitForPilotStage("Image decoding", () => decode(file), signal); canvas = decoded.canvas;
          const fingerprint = await waitForPilotStage("Image fingerprint", async () => sha256(await file.arrayBuffer()), signal);
          record.source = { filename: file.name, sha256: fingerprint, bytes: file.size, mimeType: file.type,
            nativeWidth: decoded.nativeWidth, nativeHeight: decoded.nativeHeight, width: canvas.width, height: canvas.height,
            mirrored: false, orientation: "Browser image decoder applies embedded orientation; no additional rotation, crop or mirror" };
          const report = await measure(record, canvas, signal);
          if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
          reports.set(record.key, report); record.report = pilotReportSnapshot(report); record.status = "complete";
        } catch (error) { record.status = signal.aborted ? "cancelled" : "failed"; record.failure = message(error); }
        resultsNode.append(recordDetail(record, canvas ? preview(canvas, record) : undefined));
        if (canvas) { canvas.width = 1; canvas.height = 1; }
        paintPairs(); await pause();
      }
    } catch (error) { runFailure = message(error); }
    finally {
      setSidePriorSuspended(false);
      finishPilotRecords(records, signal.aborted, runFailure);
      completedAt = new Date().toISOString(); input.disabled = false; run.disabled = false; cancel.disabled = true; download.disabled = false; controller = null;
      paintPairs(); status.textContent = `${signal.aborted ? "Cancelled" : runFailure ? `Run failed: ${runFailure}` : "Finished"}. ${records.filter((r) => r.status === "complete").length} measured; ${records.filter((r) => r.status === "failed").length} failed. Missing views remain unavailable. Export is ready.`;
    }
  })());
}
