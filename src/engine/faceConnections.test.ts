import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { FaceLandmarker } from "@mediapipe/tasks-vision";
import ts from "typescript";
import { FACE_CONNECTIONS } from "./faceConnections.js";

test("data-only face topology exactly preserves every installed SDK edge and its order", () => {
  for (const key of Object.keys(FACE_CONNECTIONS) as Array<keyof typeof FACE_CONNECTIONS>) {
    assert.deepEqual(FACE_CONNECTIONS[key], FaceLandmarker[key], `${key} changed: regenerate data and verify calibration before dependency updates`);
    assert.ok(FACE_CONNECTIONS[key].every(({ start, end }) => Number.isInteger(start) && start >= 0 && start < 478 && Number.isInteger(end) && end >= 0 && end < 478));
  }
  assert.equal(FACE_CONNECTIONS.FACE_LANDMARKS_FACE_OVAL.length, 36);
  assert.equal(FACE_CONNECTIONS.FACE_LANDMARKS_TESSELATION.length, 2556);
});

test("application modules cannot eagerly import the vision runtime just to read contours", () => {
  const root = resolve(import.meta.dirname, "..");
  const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(resolve(dir, entry.name)) : entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [resolve(dir, entry.name)] : []);
  for (const file of files(root)) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2020, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier) || node.moduleSpecifier.text !== "@mediapipe/tasks-vision") continue;
      assert.equal(node.importClause?.isTypeOnly, true, `${file} eagerly imports the vision runtime`);
    }
  }
  for (const file of ["landmarker.ts", "headCovering.ts"]) {
    assert.match(readFileSync(new URL(file, import.meta.url), "utf8"), /await import\("@mediapipe\/tasks-vision"\)/);
  }
});
