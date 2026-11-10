import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadSamples } from '../src/load-samples.js';

function sample(id = 'sample_001') {
  return {
    id,
    audio: 'audio.wav',
    speaker: 'maria',
    noise: 'kitchen',
    transcript_literal: 'quiero tres tacos al pastor',
    order_expected: {
      items: [{ item: 'taco al pastor', quantity: 3, modifiers: [] }]
    }
  };
}

async function createCorpus(t, descriptors) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kitchenbot-poc-corpus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'samples'));
  await Promise.all(descriptors.map(async ([fileName, descriptor]) => {
    await writeFile(path.join(root, 'samples', fileName), JSON.stringify(descriptor));
  }));
  await writeFile(path.join(root, 'samples', 'audio.wav'), 'placeholder');
  return path.join(root, 'samples');
}

test('loads a valid descriptor and resolves audio relative to it', async (t) => {
  const samplesDir = await createCorpus(t, [['sample_001.json', sample()]]);
  const samples = await loadSamples(samplesDir, { minSamples: 1 });

  assert.equal(samples.length, 1);
  assert.equal(samples[0].id, 'sample_001');
  assert.equal(samples[0].audioPath, path.join(samplesDir, 'audio.wav'));
});

test('rejects malformed required item fields', async (t) => {
  const invalid = sample();
  delete invalid.order_expected.items[0].modifiers;
  const samplesDir = await createCorpus(t, [['sample_001.json', invalid]]);

  await assert.rejects(() => loadSamples(samplesDir, { minSamples: 1 }), /modifiers/);
});

test('rejects duplicate sample IDs', async (t) => {
  const samplesDir = await createCorpus(t, [
    ['sample_001.json', sample('same')],
    ['sample_002.json', sample('same')]
  ]);

  await assert.rejects(() => loadSamples(samplesDir, { minSamples: 1 }), /duplicate sample id same/);
});

test('rejects a missing audio file', async (t) => {
  const missingAudio = sample();
  missingAudio.audio = 'missing.wav';
  const samplesDir = await createCorpus(t, [['sample_001.json', missingAudio]]);

  await assert.rejects(() => loadSamples(samplesDir, { minSamples: 1 }), /audio file does not exist/);
});

test('rejects a corpus smaller than the required 20 samples', async (t) => {
  const samplesDir = await createCorpus(t, [['sample_001.json', sample()]]);

  await assert.rejects(() => loadSamples(samplesDir), /expected at least 20 sample JSON files, found 1/);
});
