// Dev helper (not part of the test suite): scaffold corpus descriptors from a
// transcripts file. It fills id, audio path, and transcript_literal (a DRAFT you
// must proofread against the real audio). It leaves speaker/noise blank and
// order_expected EMPTY on purpose — those are human ground truth and must NOT be
// auto-derived from the parser or any STT.
//
// It never overwrites an existing descriptor, so your hand-filled work is safe.
//
// Usage:
//   node build-descriptors.mjs <transcripts.json> [audioExt=.ogg]
//
// transcripts.json = [{ "id": "sample_001", "text": "<literal transcript>" }, ...]
// Keep that file and voice-eval/samples/ OUT of git: they hold real order text.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const input = process.argv[2];
const ext = process.argv[3] || '.ogg';
if (!input) {
  console.error('Usage: node build-descriptors.mjs <transcripts.json> [audioExt]');
  process.exit(1);
}

const samplesDir = path.join(here, 'samples');
await mkdir(samplesDir, { recursive: true });
const transcripts = JSON.parse(await readFile(input, 'utf8'));

let created = 0;
let skipped = 0;
for (const { id, text } of transcripts) {
  if (!id || typeof text !== 'string') {
    console.error('skip (bad entry):', JSON.stringify({ id }));
    continue;
  }
  const dest = path.join(samplesDir, `${id}.json`);
  try {
    await access(dest);
    console.log('skip (exists):', id);
    skipped += 1;
    continue;
  } catch {
    // does not exist yet — create it
  }
  const descriptor = {
    id,
    audio: `../audio/${id}${ext}`,
    speaker: '',
    noise: '',
    transcript_literal: text,
    order_expected: { items: [] }
  };
  await writeFile(dest, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');
  console.log('created:', id);
  created += 1;
}

console.log(`\nDone. created ${created}, skipped ${skipped}.`);
console.log('order_expected is intentionally empty — fill it by hand from the real');
console.log('intended order, then run: npm run validate:corpus -w voice-eval');
