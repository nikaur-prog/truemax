import test from "node:test";
import assert from "node:assert/strict";
import { SIDE_POINTS } from "./sideMetrics.js";
import { REFERENCE_DIAGRAM } from "../ui/sideReference.js";

// ---------------------------------------------------------------------------
// The reference diagram has to keep telling the truth.
//
// It is a drawing of where thirteen landmarks belong, and the one way it fails
// silently is drift: a point added to or renamed in the engine, and the diagram
// still showing the old set. A guide that disagrees with the app teaches people
// to drag correct points into wrong places, which is worse than no guide.
//
// The positions used to be a hand-written table and this test read them out of
// the source as text. They are now COMPUTED from the seeder's average-head
// template, so the real values are imported and checked directly — which is
// both stronger and immune to the formatting of the file.
//
// Note what these checks now also cover: the template itself. If somebody
// retunes the seeder and puts the ear in front of the nose, this fails.
// ---------------------------------------------------------------------------

const diagram = REFERENCE_DIAGRAM;

test("every landmark the engine measures has a place in the diagram", () => {
  for (const { id } of SIDE_POINTS) {
    assert.ok(diagram[id], `${id} is missing from the reference diagram`);
  }
});

test("the diagram invents no landmark the engine does not have", () => {
  const drawn = Object.keys(diagram);
  const known = new Set(SIDE_POINTS.map((p) => p.id as string));
  assert.equal(drawn.length, SIDE_POINTS.length, `drew ${drawn.length}, engine has ${SIDE_POINTS.length}`);
  for (const id of drawn) assert.ok(known.has(id), `${id} is drawn but not measured`);
});

test("the drawn anatomy is in the right order down the face", () => {
  // Guards the coordinates themselves, not just their presence. Someone
  // adjusting the diagram by eye could easily put the nose below the mouth,
  // and a reference with the anatomy out of order is actively misleading.
  const at = (id: string): [number, number] => {
    const p = diagram[id as keyof typeof diagram];
    assert.ok(p, `${id} has no coordinates`);
    return p;
  };
  const y = (id: string) => at(id)[1];
  const x = (id: string) => at(id)[0];

  // Top to bottom.
  const downTheFace = ["trichion", "glabella", "nasion", "pronasale", "subnasale",
    "labialeSuperius", "labialeInferius", "pogonion", "menton"];
  for (let i = 1; i < downTheFace.length; i++) {
    assert.ok(
      y(downTheFace[i]) > y(downTheFace[i - 1]),
      `${downTheFace[i]} should sit below ${downTheFace[i - 1]}`,
    );
  }

  // The diagram faces left, so smaller x is further forward. The nose tip is
  // the front-most point on any face; the ear is behind everything on it.
  const front = ["glabella", "nasion", "subnasale", "labialeSuperius", "pogonion", "menton"];
  for (const id of front) {
    assert.ok(x("pronasale") < x(id), `the nose tip should sit ahead of ${id}`);
  }
  for (const id of ["pronasale", "pogonion", "menton", "cervicale"]) {
    assert.ok(x("tragion") > x(id), `the ear should sit behind ${id}`);
  }
  // The jaw corner is behind and below the joint it hinges from.
  assert.ok(y("gonion") > y("condylion"), "the jaw corner sits below the jaw top");
});
