import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The chooser itself has behavioural browser tests. These contracts keep the
// real app's file, cancellation, identity and retake entry points wired to it.
const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const section = (from: string, to: string): string => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start + from.length);
  assert.ok(start >= 0 && end > start, `Missing section: ${from}`);
  return main.slice(start, end);
};

test("general upload opens the file picker without a prior reference answer", () => {
  const upload = section('el.btnUpload.addEventListener("click"', "enablePhotoPaste({");
  assert.match(upload, /ensureScanAllowed/);
  assert.match(upload, /filePickerGeneration = generation/);
  assert.match(upload, /el\.fileInput\.click\(\)/);
  assert.doesNotMatch(upload, /void ensureSex\(/);
});

test("each selected file invalidates previous subject and reference choices", () => {
  const choice = section("function chooseUploadSubject", 'el.fileInput.addEventListener("change"');
  assert.match(choice, /expectedGeneration !== scanGeneration/);
  assert.match(choice, /const generation = \+\+scanGeneration/);
  assert.match(choice, /closeSexChooser\(\)/);
  assert.match(choice, /closeSubjectChooser\(\)/);
  assert.match(choice, /sexChosen = false/);
  assert.match(choice, /scanSubject = null/);
  assert.match(choice, /subjectAsked = false/);
  assert.match(choice, /ensureSex\([\s\S]*generation === scanGeneration[\s\S]*handleFile\(file, generation\)[\s\S]*}, file\)/);
});

test("picker cancel clears its attempt and selecting the same file works again", () => {
  const events = section('el.fileInput.addEventListener("change"', 'el.btnUpload.addEventListener("click"');
  assert.match(events, /filePickerGeneration = null/);
  assert.match(events, /el\.fileInput\.value = ""/);
  assert.match(events, /file && generation !== null\) chooseUploadSubject\(file, generation\)/);
  assert.match(events, /addEventListener\("cancel"[\s\S]*generation === scanGeneration\) resetToUpload\(\)/);
});

test("signed-out and other-person uploads start fresh; explicit self uses only the profile", () => {
  const choose = section("async function ensureSex", "/** The two facts the chooser needs");
  assert.match(choose, /askPopulation\(undefined, null\)/);
  assert.match(choose, /askPopulation\(undefined, \{ name: answer\.subject\.name \}\)/);
  assert.match(choose, /const own = profile\.sex/);
  assert.doesNotMatch(choose, /storedSex\(/);
  assert.match(choose, /\{ photo, confirm: Boolean\(photo\) \}/);
  assert.match(choose, /if \(!isCurrent\(\)\) return;\s*selectedSex = sex/);
  assert.match(choose, /if \(!isCurrent\(\)\) return;\s*saveProfile/);
});

test("retaking an uploaded photo does not restore the previous person's answer", () => {
  const retake = section("function retakeFront", "function resetToUpload");
  const uploaded = retake.slice(retake.indexOf('if (method === "upload")'), retake.indexOf('if (method === "camera"'));
  assert.match(uploaded, /filePickerGeneration = scanGeneration/);
  assert.match(uploaded, /el\.fileInput\.click\(\);\s*return/);
  assert.doesNotMatch(uploaded, /selectedSex = kept/);
  const reset = section("function resetToUpload", "async function handleFile");
  assert.match(reset, /closeSexChooser\(\)/);
  assert.match(reset, /closeSubjectChooser\(\)/);
  assert.match(reset, /filePickerGeneration = null/);
  assert.match(reset, /sexChosen = false/);
});
