import type { Report } from "../engine/types.js";
import { REGION_NAMES } from "../engine/scoring.js";
import { directionFor, distFor } from "../engine/metrics.js";
import { reliabilityOf } from "../engine/reliability.js";

// ---------------------------------------------------------------------------
// A scan, dumped as text you can paste to somebody.
//
// Calibrating this engine means comparing what it measured against what a human
// says the face is worth, and until now the only way to move a scan out of the
// browser was a screenshot of eight region cards. That is enough to see THAT the
// jaw is wrong and nowhere near enough to see WHICH of the three jaw metrics is
// wrong, or by how much, or whether the ideal or the spread is at fault.
//
// So this prints the whole measurement: every metric's raw value, where that
// value sits against the population, which scoring reference it uses, and how
// much of it is signal rather than photo-to-photo noise. It is deliberately
// plain text rather than JSON — it gets pasted into a chat window by a person,
// not parsed by a program, and a wall of braces is harder to read at 3am.
//
// The `off` column is the one that matters most and is the reason this exists.
// It is how many standard deviations the reading sits from its scoring reference, so
// a metric that reads +3.0 on a feature a human calls excellent is not a face
// with a problem — it is a metric whose model of "ideal" runs backwards, and no
// amount of rescaling the aggregate will fix it.
// ---------------------------------------------------------------------------

export interface DiagnosticsCapture {
  /** Head pose the capture was taken at, before correction. */
  yawDeg?: number;
  pitchDeg?: number;
  rollDeg?: number;
  /** 0..1 from blendshapes. A smile skews every mouth and jaw metric. */
  smileScore?: number;
  /** ISO date of the scan, so two dumps can be ordered and dated. */
  at?: string;
  /** An id for the scan itself, so a duplicated paste is detectable. */
  scanId?: string;
}

export function diagnosticsText(
  report: Report,
  label: string,
  capture?: DiagnosticsCapture,
): string {
  const lines: string[] = [];
  const n = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "–");

  lines.push(`TRUEMAX SCAN DIAGNOSTICS`);
  lines.push(`face: ${label || "(unnamed)"}`);
  lines.push(`scored against: ${report.sex === "male" ? "men" : "women"}`);
  // The conditions the photograph was taken under, which decide whether two
  // dumps of the same person can be compared at all.
  //
  // Without these the dump is unusable for the one question it is most needed
  // for. Repeatability — does a score change mean the face changed — is
  // measured by scanning one person twice, and a scan taken at 20° of yaw or
  // mid-smile differs from a level neutral one for reasons that have nothing
  // to do with the face. tools/reliability.mjs already gates on exactly these
  // numbers and could not read them here, so a badly-posed capture would have
  // been averaged in silently and read as instability in the metric.
  //
  // Printed for every scan, not only bad ones: a line that appears only when
  // something is wrong cannot be used to confirm that nothing was.
  if (capture) {
    const pose = [
      capture.yawDeg === undefined ? null : `yaw ${n(capture.yawDeg, 1)}°`,
      capture.pitchDeg === undefined ? null : `pitch ${n(capture.pitchDeg, 1)}°`,
      capture.rollDeg === undefined ? null : `roll ${n(capture.rollDeg, 1)}°`,
      capture.smileScore === undefined ? null : `smile ${n(capture.smileScore)}`,
    ].filter(Boolean);
    if (pose.length) lines.push(`capture: ${pose.join("  ·  ")}`);
    if (capture.at) lines.push(`taken: ${capture.at}`);
    if (capture.scanId) lines.push(`scan: ${capture.scanId}`);
  }
  lines.push(`overall: ${n(report.overall, 1)}  ·  percentile ${n(report.overallPercentile, 1)}  ·  potential ${n(report.potential, 1)}`);
  // The two views separately, when both were measured.
  //
  // Absent from this dump until now, and it is the figure an external
  // comparison most needs: a merged overall is a correlated aggregation of two
  // z-scores, so it cannot be read back as "roughly the front". Comparing a
  // competitor's front-only figure against our merged one, or inferring our
  // front from our merged and our side, both invent the number that matters.
  if (report.views) {
    lines.push(
      `front: ${n(report.views.front.score, 1)} (pct ${n(report.views.front.percentile, 1)})` +
        `  ·  side: ${n(report.views.side.score, 1)} (pct ${n(report.views.side.percentile, 1)})`,
    );
  } else if (report.metrics.length && report.metrics.every((m) => m.def.view === "side")) {
    lines.push(`views: side only: no front profile in this scan`);
  } else {
    lines.push(`views: front only: no side profile in this scan`);
  }
  lines.push("");

  lines.push(`REGIONS`);
  lines.push(`  score  reliab  region`);
  for (const r of [...report.regions].sort((a, b) => b.score - a.score)) {
    if (!r.metrics.length) continue;
    lines.push(`  ${n(r.score, 1).padStart(5)}  ${n(r.reliability).padStart(6)}  ${REGION_NAMES[r.region]}`);
  }
  lines.push("");

  lines.push(`METRICS`);
  // Sorted by distance from ideal, worst first: the metrics dragging the score
  // down are the ones a disagreement is usually about, so they go where the eye
  // lands rather than at the bottom of thirty rows.
  lines.push(`  score    off  reliab  dir     value  reference  metric`);
  const rows = report.metrics
    .filter((m) => !m.implausible)
    .map((m) => {
      const d = distFor(m.def, report.sex);
      const ideal = d.ideal ?? d.mean;
      const off = d.sd > 0 ? (m.value - ideal) / d.sd : NaN;
      return { m, ideal, off };
    })
    .sort((a, b) => a.m.score - b.m.score);

  for (const { m, ideal, off } of rows) {
    const dir = directionFor(m.def, report.sex).padEnd(6);
    lines.push(
      `  ${n(m.score, 1).padStart(5)}  ${(off >= 0 ? "+" : "") + n(off, 1)}σ`.padEnd(17) +
        `  ${n(reliabilityOf(m.def.id)).padStart(4)}  ${dir}  ` +
        `${n(m.value, m.def.decimals).padStart(9)}  ${n(ideal, m.def.decimals).padStart(9)}  ${m.def.name}`,
    );
  }

  lines.push("");
  lines.push("REFERENCE NOTES");
  lines.push("reference = band target (explicit ideal, otherwise mean); for higher/lower directions it is the population mean, not an ideal to reach.");
  lines.push("off = (value - reference) / reference SD. It is not a landmark-position error or an attractiveness verdict.");
  lines.push("reliab = metric repeatability estimate, not confidence that these particular points are correctly placed. A zero-reliability metric has no aggregate weight.");
  for (const { m } of rows) {
    const d = distFor(m.def, report.sex);
    const unit = m.def.unit || "ratio";
    const band = directionFor(m.def, report.sex) === "band"
      ? `; model band ${n(m.idealRange[0], m.def.decimals)} to ${n(m.idealRange[1], m.def.decimals)}`
      : "; directional scoring, no two-sided ideal";
    lines.push(`  ${m.def.id} [${m.def.view}, ${unit}]: mean ${n(d.mean, m.def.decimals)}; SD ${n(d.sd, m.def.decimals)}${band}`);
  }

  const dropped = report.metrics.filter((m) => m.implausible);
  if (dropped.length) {
    lines.push("");
    lines.push(`EXCLUDED (unavailable or outside measurement checks; not scored)`);
    for (const m of dropped) {
      const reason = !Number.isFinite(m.value)
        ? "not measured: required landmark or geometry unavailable"
        : "outside measurement checks: review the photo and point placement";
      lines.push(`  ${m.def.name}: ${n(m.value, m.def.decimals)} (${reason})`);
    }
  }

  return lines.join("\n");
}

/**
 * Puts the dump on the clipboard, falling back to a selectable textarea.
 *
 * navigator.clipboard needs a secure context and a user gesture, and quietly
 * rejects in a few browsers even with both. Since the entire point of this
 * button is getting text OUT of the page, a silent failure would be the one
 * outcome worth guarding against — so the fallback shows the text and selects
 * it, which is the manual version of the same job.
 */
export async function copyDiagnostics(
  report: Report,
  label: string,
  capture?: DiagnosticsCapture,
): Promise<boolean> {
  const text = diagnosticsText(report, label, capture);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const host = document.createElement("div");
    host.className = "diag-fallback";
    host.innerHTML = `<div class="diag-sheet">
      <p>Copy this and paste it back:</p>
      <textarea readonly></textarea>
      <button type="button" class="btn pri">Done</button>
    </div>`;
    const area = host.querySelector("textarea")!;
    area.value = text;
    document.body.appendChild(host);
    area.focus();
    area.select();
    host.querySelector("button")!.onclick = () => host.remove();
    return false;
  }
}
