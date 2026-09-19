import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const PILOT_IDS = ['f', 'm'].flatMap(prefix => Array.from({ length: 10 }, (_, i) => `${prefix}${String(i + 1).padStart(2, '0')}`));
const views = ['front', 'side'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function validatePilotManifest(manifest) {
  if (!Array.isArray(manifest?.people) || manifest.people.length !== 20) throw new Error('The pilot must contain exactly 20 identities, not 40 people.');
  const people = new Map();
  for (const person of manifest.people) {
    if (!PILOT_IDS.includes(person.id) || people.has(person.id)) throw new Error(`Invalid or duplicate identity: ${person.id}`);
    if (typeof person.name !== 'string' || !person.name.trim()) throw new Error(`Missing alias: ${person.id}`);
    if (person.synthetic !== true || !Number.isInteger(person.age) || person.age < 18) throw new Error(`Missing fictional adult declaration: ${person.id}`);
    const expected = person.id.startsWith('f') ? 'woman' : 'man';
    if (person.gender !== expected) throw new Error(`Declared reference group does not match the existing ID: ${person.id}`);
    for (const view of views) {
      if (typeof person[view] !== 'string' || path.basename(person[view]) !== `${person.id}-${view}.png`) throw new Error(`Missing or incorrectly named ${view} image: ${person.id}`);
    }
    people.set(person.id, person);
  }
  return PILOT_IDS.map(id => people.get(id));
}

function readme(people) {
  return `# TrueMax calibration pilot: 20 pairs\n\n` +
    `This is the existing synthetic pilot: **20 fictional adult identities, 40 original PNGs** (20 front + 20 side). The names are aliases. No image has been cropped, resized, mirrored or regenerated for this package.\n\n` +
    `## Start here\n\n` +
    `1. Extract this ZIP. Open gallery.html locally to see each front/side pair and its name. The gallery has no external requests.\n` +
    `2. Sign in to the owner/admin account, then open League > Tools > Calibration (/league/tools#calibrate). Use the build containing the calibration-review changes when available.\n` +
    `3. Add the face. On the Save face form, put its stable ID (for example "f01") in the dedicated Reference ID field. The separate private Label can contain the alias "Mary Jane". Reference ID is exported; the private label is not. Do not put personal information in Reference ID. Select Women for the f IDs and Men for the m IDs; these are the original generation declarations, not classifications inferred from the images.\n` +
    `4. Upload images/f01-front.png, then images/f01-side.png for that person. Keep the original files and filenames. Never match a front image with a different ID's side image.\n` +
    `5. Check the side direction and review every visible landmark, especially the ear notch, jaw corner, chin and neck. Confirm the review acknowledgement only after checking all 13 points. If a point cannot be located reliably, keep that limitation in the review notes rather than guessing.\n` +
    `6. Save the face. You may leave an unknown attractiveness rating empty. Start with one complete pair, then repeat for the other 19.\n` +
    `7. Export all capture diagnostics and keep the JSON privately. Check that each new exported row has the matching referenceId (f01 to f10 or m01 to m10). Send that export back with the same IDs for any external screenshots/reports. Saving reviewed points gathers evidence; it does not automatically retrain placement or fit scoring ideals.\n\n` +
    `## Important limits\n\n` +
    `These generated front/side pairs have not been verified as anatomically consistent. They are useful for diagnosing placement failures, not for establishing population norms, real anatomical ground truth, or a 90% accuracy claim. Declared adult ages are generation metadata, not estimates from the images.\n\n` +
    `No FaceIQ results are included. This packaging step made no external uploads or scans and spent no third-party credits. The prior TrueMax diagnostic runs are not new accuracy validation. Review originals and any competitor reports only through authorized workflows.\n\n` +
    `manifest.json records exact dimensions, byte sizes and SHA-256 hashes. SHA256SUMS.txt covers the 40 image files. The source pilot manifest hash and diagnostic-run hashes are retained without private filesystem paths.\n\n` +
    `## Identity checklist\n\n| ID | Alias | Declared group | Files |\n| --- | --- | --- | --- |\n` +
    people.map(p => `| ${p.id} | ${p.name.replaceAll('|', '\\|')} | ${p.declaredReferenceGroup} | ${p.id}-front.png + ${p.id}-side.png |`).join('\n') + '\n';
}

function gallery(people) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"><title>TrueMax: 20 calibration pairs</title><style>body{margin:0;background:#f4f5f2;color:#182b28;font:16px/1.5 system-ui,sans-serif}main{max-width:1080px;padding:32px 18px;margin:auto}h1{font-size:32px;line-height:1.2}header{margin-bottom:28px}article{background:white;padding:20px;border:1px solid #dfe5e0;border-radius:18px;margin:20px 0;break-inside:avoid}h2{margin:0 0 4px;font-size:22px}.meta{color:#526560;margin:0 0 16px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{display:block;width:100%;height:auto;border-radius:10px}figcaption{font-size:14px;margin-top:8px;overflow-wrap:anywhere}a{color:#106557}footer{margin:24px 0}@media(max-width:480px){main{padding:20px 12px}article{padding:12px}.pair{gap:8px}h1{font-size:26px}}@media print{article{page-break-inside:avoid}}</style></head><body><main><header><h1>20 fictional identities. 40 original images.</h1><p>10 declared women and 10 declared men, each with a front and side image. Synthetic diagnostic pilot, not anatomical ground truth or scoring validation.</p><p>Enter f01, m01, etc. in Calibration's <strong>Reference ID</strong> field. Put the alias in the separate private Label if useful. Reference IDs survive export; private labels do not.</p><p>Review the actual points and facing direction; generated cross-view anatomy is unverified.</p><a href="README.md">Read the calibration checklist</a> · <a href="manifest.json">Image manifest and checksums</a></header>` +
    people.map(p => `<article><h2>${escapeHtml(p.id)} · ${escapeHtml(p.name)}</h2><p class="meta">Declared group: ${escapeHtml(p.declaredReferenceGroup)} · fictional adult age: ${p.declaredAge}</p><div class="pair">` + views.map(view => `<figure><a href="${p.images[view].path}" download><img src="${p.images[view].path}" width="${p.images[view].width}" height="${p.images[view].height}" loading="lazy" alt="${escapeHtml(p.id)} ${view} image"></a><figcaption>${view === 'front' ? 'Front' : 'Side'} · ${escapeHtml(path.basename(p.images[view].path))}</figcaption></figure>`).join('') + '</div></article>').join('') +
    '<footer>Original pixels preserved. No network requests, analytics or uploads in this gallery.</footer></main></body></html>\n';
}

async function ensureAbsent(filename) {
  try { await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw new Error(`Refusing to overwrite existing output: ${filename}`);
}

export async function packagePilot(sourceDirectory, outputDirectory) {
  const source = await fs.realpath(sourceDirectory);
  const output = path.resolve(outputDirectory);
  const archive = `${output}.zip`;
  if (output === source || output.startsWith(`${source}${path.sep}`)) throw new Error('Output must be outside the private source pilot directory.');
  await ensureAbsent(output);
  await ensureAbsent(archive);
  const manifestBytes = await fs.readFile(path.join(source, 'manifest.json'));
  const originals = validatePilotManifest(JSON.parse(manifestBytes));
  const referenceDirectory = await fs.realpath(path.join(source, 'references'));
  const diagnosticRuns = [];
  const runs = [];
  for (const filename of ['truemax-baseline.json', 'truemax-repeat.json']) {
    const bytes = await fs.readFile(path.join(source, filename));
    const records = JSON.parse(bytes).data?.records;
    if (!Array.isArray(records) || records.length !== 40) throw new Error(`Expected 40 diagnostic source records: ${filename}`);
    const map = new Map(records.map(record => [record.key, record.source]));
    if (map.size !== 40) throw new Error(`Duplicate diagnostic record: ${filename}`);
    runs.push(map);
    diagnosticRuns.push({ filename, sha256: sha256(bytes), sourceImagesMatched: 40 });
  }
  const people = [];
  const inputs = [];
  for (const person of originals) {
    const images = {};
    for (const view of views) {
      const key = `${person.id}-${view}`;
      const input = await fs.realpath(path.join(referenceDirectory, `${key}.png`));
      if (path.dirname(input) !== referenceDirectory) throw new Error(`Image escapes the private references directory: ${key}`);
      const bytes = await fs.readFile(input);
      const digest = sha256(bytes);
      const metadata = await sharp(bytes, { failOn: 'warning' }).metadata();
      await sharp(bytes, { failOn: 'warning' }).stats();
      if (metadata.format !== 'png' || !metadata.width || !metadata.height) throw new Error(`Not a readable original PNG: ${key}`);
      if (runs.some(run => run.get(key)?.sha256 !== digest || run.get(key)?.bytes !== bytes.length)) throw new Error(`Image differs from the prior diagnostic inputs: ${key}`);
      let originalGenerationSourceVerified = false;
      if (typeof person[`${view}Source`] === 'string') {
        try {
          const generated = await fs.readFile(person[`${view}Source`]);
          if (sha256(generated) !== digest) throw new Error(`Image differs from its original generation source: ${key}`);
          originalGenerationSourceVerified = true;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      images[view] = { path: `images/${key}.png`, sha256: digest, bytes: bytes.length, width: metadata.width, height: metadata.height, originalGenerationSourceVerified };
      inputs.push({ input, ...images[view] });
    }
    people.push({ id: person.id, name: person.name, synthetic: true, declaredAge: person.age, declaredReferenceGroup: person.gender === 'woman' ? 'Women' : 'Men', anatomicalPairVerified: false, images });
  }
  const portableManifest = {
    schemaVersion: 1,
    packagedAt: new Date().toISOString(),
    identityCount: 20,
    imageCount: 40,
    purpose: 'Existing synthetic diagnostic pilot. Not population calibration or anatomical ground truth.',
    transformations: 'None. Original image bytes preserved.',
    sourceManifestSha256: sha256(manifestBytes),
    diagnosticRuns,
    people,
  };
  await fs.mkdir(output);
  await fs.mkdir(path.join(output, 'images'));
  for (const item of inputs) {
    await fs.copyFile(item.input, path.join(output, item.path), constants.COPYFILE_EXCL);
    if (sha256(await fs.readFile(path.join(output, item.path))) !== item.sha256) throw new Error(`Copied image failed verification: ${item.path}`);
  }
  const textFiles = {
    'README.md': readme(people),
    'manifest.json': `${JSON.stringify(portableManifest, null, 2)}\n`,
    'gallery.html': gallery(people),
    'SHA256SUMS.txt': inputs.map(item => `${item.sha256}  ${item.path}`).join('\n') + '\n',
  };
  for (const [name, content] of Object.entries(textFiles)) await fs.writeFile(path.join(output, name), content, { flag: 'wx' });
  const packageFiles = [...Object.keys(textFiles), ...inputs.map(item => item.path)].sort();
  execFileSync('zip', ['-X', '-q', archive, ...packageFiles], { cwd: output });
  execFileSync('unzip', ['-t', archive]);
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' }).trim().split('\n').sort();
  if (JSON.stringify(entries) !== JSON.stringify(packageFiles)) throw new Error('Unexpected ZIP contents.');
  for (const filename of packageFiles) {
    const archived = execFileSync('unzip', ['-p', archive, filename], { maxBuffer: 32 * 1024 * 1024 });
    if (sha256(archived) !== sha256(await fs.readFile(path.join(output, filename)))) throw new Error(`ZIP entry failed byte-for-byte verification: ${filename}`);
  }
  const archiveBytes = await fs.readFile(archive);
  return { outputDirectory: output, archive, archiveSha256: sha256(archiveBytes), archiveBytes: archiveBytes.length, identities: people.length, images: inputs.length, verifiedZipEntries: packageFiles.length, originalGenerationSourcesVerified: inputs.filter(item => item.originalGenerationSourceVerified).length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , source, output] = process.argv;
  if (!source || !output || process.argv.length !== 4) {
    console.error('Usage: node tools/package-calibration-pilot.mjs <private-pilot-directory> <new-output-directory>');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await packagePilot(source, output), null, 2)); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
