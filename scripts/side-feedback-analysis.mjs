/**
 * Convert stored per-axis fractions back to common pixel units before dividing
 * by facial height. Otherwise horizontal corrections are inflated by image H/W.
 * This is diagnostic only. It never updates a placement or a calibration table.
 */
export function sideFeedbackOffsets(row, pointIds) {
  if (!["new", "reviewed", "incorporated"].includes(row.review_status)) return null;
  const width = row.image_width;
  const height = row.image_height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (row.face_dir !== 1 && row.face_dir !== -1) return null;
  const auto = row.automatic_points;
  const fixed = row.corrected_points;
  if (!auto || !fixed) return null;
  const fractionHeight = Math.abs((fixed.menton?.y ?? NaN) - (fixed.trichion?.y ?? NaN));
  if (!Number.isFinite(fractionHeight) || fractionHeight < 0.05) return null;
  const faceHeightPixels = fractionHeight * height;
  const offsets = {};
  for (const id of pointIds) {
    const a = auto[id];
    const c = fixed[id];
    if (!a || !c || ![a.x, a.y, c.x, c.y].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) continue;
    offsets[id] = {
      dx: row.face_dir * (c.x - a.x) * width / faceHeightPixels,
      dy: (c.y - a.y) * height / faceHeightPixels,
    };
  }
  return offsets;
}

/** A user-confirmed seed is not an independent annotation for an offset. */
export function sideFeedbackCalibrationOffsets(row, pointIds, now = Date.now()) {
  if (!["reviewed", "incorporated"].includes(row.review_status)) return null;
  if (typeof row.expires_at !== "string" || !(Date.parse(row.expires_at) > now)) return null;
  if (!Array.isArray(row.moved_point_ids) || !row.moved_point_ids.length) return null;
  const offsets = sideFeedbackOffsets(row, pointIds);
  if (!offsets) return null;
  return Object.fromEntries(Object.entries(offsets).filter(([id]) => row.moved_point_ids.includes(id)));
}

/** Keyset pagination avoids the Data API's first-page default and offset skips. */
export async function fetchSideFeedbackRows(url, key, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? new Date().toISOString();
  const pageSize = options.pageSize ?? 500;
  if (!Number.isFinite(Date.parse(now))) throw new Error("Invalid feedback snapshot time");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("Invalid feedback page size");
  const rows = [];
  const seen = new Set();
  let cursor = null;
  for (let page = 0; page < 200; page++) {
    const endpoint = new URL("rest/v1/side_landmark_feedback", `${url.replace(/\/$/, "")}/`);
    endpoint.searchParams.set("select", "id,face_dir,image_width,image_height,review_status,seed_method,seed_version,automatic_points,corrected_points,moved_point_ids,created_at,expires_at");
    endpoint.searchParams.set("order", "created_at.asc,id.asc");
    endpoint.searchParams.set("limit", String(pageSize));
    endpoint.searchParams.set("created_at", `lte.${now}`);
    endpoint.searchParams.set("expires_at", `gt.${now}`);
    if (cursor) endpoint.searchParams.set("or", `(created_at.gt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.gt.${cursor.id}))`);
    const response = await fetcher(endpoint.toString(), { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!response.ok) throw new Error(`Feedback read failed: HTTP ${response.status}`);
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("Feedback read did not return rows");
    for (const row of batch) {
      if (!row || typeof row.id !== "string" || !/^[0-9a-f-]{36}$/i.test(row.id)
        || typeof row.created_at !== "string" || !Number.isFinite(Date.parse(row.created_at))) {
        throw new Error("Feedback pagination evidence is missing");
      }
      if (seen.has(row.id)) throw new Error("Feedback pagination repeated a row");
      if (Date.parse(row.created_at) > Date.parse(now) || !(Date.parse(row.expires_at) > Date.parse(now))) {
        throw new Error("Feedback returned a row outside the active snapshot");
      }
      seen.add(row.id);
      rows.push(row);
    }
    // A project may cap the Data API below the requested page size. Continue
    // until an empty page rather than mistaking that smaller page for EOF.
    if (batch.length === 0) return rows;
    cursor = batch[batch.length - 1];
  }
  throw new Error("Feedback pagination limit reached; no partial calibration report was produced");
}
