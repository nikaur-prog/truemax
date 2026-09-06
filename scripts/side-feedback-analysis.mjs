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
