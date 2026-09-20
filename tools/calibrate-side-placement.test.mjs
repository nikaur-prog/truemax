import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POINT_IDS } from "./compare-placement-pilot.mjs";
import { PROTOCOL, automaticFrame, fitResiduals, applyResiduals, evaluate, selectCaptures, validateLocalSeed, privateOutputPath } from "./calibrate-side-placement.mjs";

function fixture(id = "m01", method = "mesh") {
  const automatic = Object.fromEntries(POINT_IDS.map((key, index) => [key, { x: 500 + index * 2, y: 200 + index * 12 }]));
  automatic.glabella = { x: 520, y: 220 }; automatic.subnasale = { x: 540, y: 380 };
  const reviewed = structuredClone(automatic);
  for (const key of PROTOCOL.targets) { reviewed[key].x -= 20; reviewed[key].y += 15; }
  return { id, method, faceDir: 1, width: 1000, height: 1000, automatic, reviewed,
    assistant: structuredClone(reviewed), assistantMetadata: {}, priorExposure: "declared-none" };
}
const rows = (n = 8, method = "mesh") => Array.from({ length: n }, (_, i) => fixture(`m${String(i + 1).padStart(2, "0")}`, method));

test("constant synthetic residual is recovered out of identity", () => {
  const result = evaluate(rows());
  assert.ok(result.aggregate.candidateOwner.mean < 1e-12);
  assert.ok(result.aggregate.automaticOwner.mean > 0);
  for (const fold of result.folds) assert.ok(!fold.trainingIdentityIds.includes(fold.id));
  assert.equal(result.aggregate.candidateOwner.count, 8 * 13);
});
test("held-out labels cannot change that identity's prediction", () => {
  const data = rows(); const first = evaluate(data).folds[0];
  for (const p of Object.values(data[0].reviewed)) { p.x += 250; p.y += 100; }
  const after = evaluate(data).folds[0];
  assert.deepEqual(first.candidatePoints, after.candidatePoints);
  assert.notEqual(first.points[0].candidateOwner, after.points[0].candidateOwner);
});
test("frozen assistant labels never affect fitting or prediction", () => {
  const data = rows(); const first = evaluate(data);
  for (const row of data) for (const id of POINT_IDS) row.assistant[id] = null;
  const next = evaluate(data);
  assert.deepEqual(first.fullDevelopmentFit, next.fullDevelopmentFit);
  assert.deepEqual(first.folds.map((f) => f.candidatePoints), next.folds.map((f) => f.candidatePoints));
  assert.equal(next.aggregate.candidateAssistant.count, 0);
  assert.equal(next.aggregate.candidateOwner.count, 8 * 13);
});
test("brow/nose/lips not selected for calibration remain exactly unchanged", () => {
  const data = rows(); const result = applyResiduals(data[0], fitResiduals(data.slice(1)));
  for (const id of POINT_IDS.filter((id) => !PROTOCOL.targets.includes(id))) assert.deepEqual(result.points[id], data[0].automatic[id]);
});
test("method-specific minimum prevents a singleton model from borrowing another method", () => {
  const data = [...rows(), fixture("f01", "segmentation")];
  const result = evaluate(data).folds.at(-1);
  assert.deepEqual(result.candidatePoints, data.at(-1).automatic);
});
test("duplicate identities fail closed instead of leaking across folds", () => {
  assert.throws(() => evaluate([...rows(), fixture("m01")]), /Duplicate/);
  assert.throws(() => fitResiduals([...rows(), fixture("m01")]), /one capture/);
});
test("invalid automatic anchors fall back without removing errors", () => {
  const data = rows(); data[0].automatic.subnasale = { ...data[0].automatic.glabella };
  const result = evaluate(data);
  assert.equal(automaticFrame(data[0]), null);
  assert.deepEqual(result.folds[0].candidatePoints, data[0].automatic);
  assert.deepEqual(result.folds[0].rejected, ["automatic-frame-unavailable"]);
  assert.equal(result.aggregate.candidateOwner.count, 8 * 13);
});
test("out-of-image predictions fall back, remain counted, and are reported", () => {
  const row = fixture(); const model = { groups: { mesh: { menton: { u: 100, v: 100 } } } };
  const result = applyResiduals(row, model);
  assert.deepEqual(result.points.menton, row.automatic.menton);
  assert.deepEqual(result.rejected, ["menton"]);
});
test("automatic-only frame is equivariant under mirrored facing direction", () => {
  const data = rows(); const model = fitResiduals(data);
  const right = applyResiduals(data[0], model);
  const left = structuredClone(data[0]); left.faceDir = -1;
  for (const p of Object.values(left.automatic)) p.x = left.width - p.x;
  const mirrored = applyResiduals(left, model);
  for (const id of POINT_IDS) {
    assert.ok(Math.abs(mirrored.points[id].x - (left.width - right.points[id].x)) < 1e-9);
    assert.ok(Math.abs(mirrored.points[id].y - right.points[id].y) < 1e-9);
  }
});
test("frame and correction scale with image size rather than fixed pixels", () => {
  const row = fixture(); const model = fitResiduals(rows()); const expected = applyResiduals(row, model);
  const doubled = structuredClone(row); doubled.width *= 2; doubled.height *= 2;
  for (const p of Object.values(doubled.automatic)) { p.x *= 2; p.y *= 2; }
  const actual = applyResiduals(doubled, model);
  for (const id of POINT_IDS) assert.deepEqual(actual.points[id], { x: expected.points[id].x * 2, y: expected.points[id].y * 2 });
});
test("evaluation never mutates input annotations or automatic coordinates", () => {
  const data = rows(); const before = structuredClone(data); evaluate(data); assert.deepEqual(data, before);
});

const sha = "a".repeat(64); const otherSha = "b".repeat(64);
const reference = [{ id: "m01", image: { sha256: sha } }];
const raw = { faces: [{ id: "saved1", referenceId: "f02", referenceGroup: "male",
  diagnostics: { referenceGroup: "male", side: { imageSource: { originalFileSha256: sha } } } }] };
const selection = { schemaVersion: 1, sourceSha256: sha, annotationSha256: otherSha,
  selected: [{ captureId: "saved1", referenceId: "m01" }], excluded: [] };
test("selection fixes only the derived ID and logs original provenance", () => {
  const before = structuredClone(raw); const result = selectCaptures(raw, reference, selection, sha, otherSha);
  assert.equal(result.data.faces[0].referenceId, "m01");
  assert.equal(result.audit[0].originalReferenceId, "f02"); assert.deepEqual(raw, before);
});
test("selection is bound to exact exports and frozen annotations", () => {
  assert.throws(() => selectCaptures(raw, reference, selection, otherSha, otherSha), /SHA-256/);
  assert.throws(() => selectCaptures(raw, reference, selection, sha, sha), /SHA-256/);
});
test("selection cannot silently drop or double-select records", () => {
  assert.throws(() => selectCaptures(raw, reference, { ...selection, selected: [] }, sha, otherSha), /every raw/);
  assert.throws(() => selectCaptures(raw, reference, { ...selection, selected: [...selection.selected, ...selection.selected] }, sha, otherSha), /duplicate/);
});
test("image mismatch or wrong reference group fail before fitting", () => {
  const bad = structuredClone(raw); bad.faces[0].diagnostics.side.imageSource.originalFileSha256 = otherSha;
  assert.throws(() => selectCaptures(bad, reference, selection, sha, otherSha), /fingerprint/);
  bad.faces[0].diagnostics.side.imageSource.originalFileSha256 = sha; bad.faces[0].referenceGroup = "female";
  assert.throws(() => selectCaptures(bad, reference, selection, sha, otherSha), /reference group/);
});

test("only explicit unmodified local detector provenance enters a method group", () => {
  const points = fixture().automatic;
  const side = { seedMethod: "mesh", automaticPoints: points, diagnostics: { localMethod: "mesh", templateFallback: false,
    coordinateSpace: "review-image-pixels", localAutomaticPoints: structuredClone(points) } };
  assert.doesNotThrow(() => validateLocalSeed(side));
  assert.throws(() => validateLocalSeed({ ...side, seedMethod: "fused" }), /provenance/);
  assert.throws(() => validateLocalSeed({ ...side, diagnostics: { ...side.diagnostics, templateFallback: true } }), /provenance/);
  assert.throws(() => validateLocalSeed({ ...side, diagnostics: { ...side.diagnostics, localMethod: "segmentation" } }), /provenance/);
  assert.throws(() => validateLocalSeed({ ...side, diagnostics: undefined }), /provenance/);
  side.diagnostics.localAutomaticPoints.menton.x += 1;
  assert.throws(() => validateLocalSeed(side), /must equal/);
});
test("private artifact path rejects public targets and symlinked roots or ancestors", async () => {
  const repo = await mkdtemp(join(tmpdir(), "truemax-private-output-test-"));
  const root = join(repo, ".calibration-pilot"); const publicDir = join(repo, "public");
  await mkdir(publicDir); await symlink(publicDir, root);
  await assert.rejects(privateOutputPath(repo, join(root, "model.json")), /symlink/);
  const cleanRepo = await mkdtemp(join(tmpdir(), "truemax-private-output-test-"));
  const cleanRoot = join(cleanRepo, ".calibration-pilot"); await mkdir(cleanRoot);
  await symlink(publicDir, join(cleanRoot, "redirect"));
  await assert.rejects(privateOutputPath(cleanRepo, join(cleanRoot, "redirect/new/model.json")), /symlink/);
  await assert.rejects(privateOutputPath(cleanRepo, join(cleanRepo, "public/model.json")), /inside/);
  const good = join(cleanRoot, "new/model.json");
  assert.equal(await privateOutputPath(cleanRepo, good), good);
});
