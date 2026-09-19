import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { packagePilot, PILOT_IDS, validatePilotManifest } from './package-calibration-pilot.mjs';

function manifest() {
  return { people: PILOT_IDS.map(id => ({ id, name: `Test ${id}`, age: 28, synthetic: true, gender: id.startsWith('f') ? 'woman' : 'man', front: `/private/references/${id}-front.png`, side: `/private/references/${id}-side.png` })) };
}

test('requires exactly 20 complete, uniquely identified adult pairs', () => {
  assert.equal(validatePilotManifest(manifest()).length, 20);
  for (const mutate of [
    m => m.people.pop(),
    m => { m.people[1].id = m.people[0].id; },
    m => { m.people[0].side = null; },
    m => { m.people[0].side = '/private/references/f02-side.png'; },
    m => { m.people[0].synthetic = false; },
    m => { m.people[0].age = 17; },
    m => { m.people[0].gender = 'man'; },
  ]) {
    const input = manifest(); mutate(input);
    assert.throws(() => validatePilotManifest(input));
  }
});

test('archive preserves source bytes, diagnoses source changes and refuses overwrites', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'truemax-package-test-'));
  try {
    const source = path.join(temp, 'source');
    const reference = path.join(source, 'references');
    await fs.mkdir(reference, { recursive: true });
    const data = manifest();
    const pixel = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } }).png().toBuffer();
    const hash = createHash('sha256').update(pixel).digest('hex');
    const records = [];
    for (const person of data.people) {
      for (const view of ['front', 'side']) {
        const key = `${person.id}-${view}`;
        person[view] = path.join(reference, `${key}.png`);
        person[`${view}Source`] = person[view];
        await fs.writeFile(person[view], pixel);
        records.push({ key, source: { bytes: pixel.length, sha256: hash } });
      }
    }
    await fs.writeFile(path.join(source, 'manifest.json'), JSON.stringify(data));
    for (const file of ['truemax-baseline.json', 'truemax-repeat.json']) await fs.writeFile(path.join(source, file), JSON.stringify({ data: { records } }));
    const output = path.join(temp, 'download');
    const result = await packagePilot(source, output);
    assert.equal(result.images, 40);
    assert.equal(result.verifiedZipEntries, 44);
    assert.equal(result.originalGenerationSourcesVerified, 40);
    const packaged = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
    assert.equal(packaged.people[0].images.front.sha256, hash);
    assert.equal(JSON.stringify(packaged).includes(temp), false, 'No private absolute filesystem paths in portable manifest.');
    assert.deepEqual(await fs.readFile(path.join(output, 'images/f01-front.png')), pixel);
    await assert.rejects(packagePilot(source, output), /Refusing to overwrite/);
    await fs.writeFile(path.join(reference, 'f01-front.png'), await sharp(pixel).negate().png().toBuffer());
    await assert.rejects(packagePilot(source, path.join(temp, 'changed')), /differs from the prior diagnostic inputs/);
    await assert.rejects(fs.stat(path.join(temp, 'changed')), { code: 'ENOENT' });
  } finally {
    // Only this test's newly created, explicit temporary directory is removed.
    await fs.rm(temp, { recursive: true, force: true });
  }
});
