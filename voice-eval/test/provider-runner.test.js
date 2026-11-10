import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEnabledProviders } from '../src/providers/index.js';
import { runPoc } from '../src/run.js';

const aliases = {
  'taco al pastor': ['tacos al pastor'],
  'agua de horchata': ['horchata']
};

function descriptor(id, transcript, expected) {
  return {
    id,
    audio: `${id}.ogg`,
    speaker: 'fixture',
    noise: 'none',
    transcript_literal: transcript,
    order_expected: expected
  };
}

async function createFixtures(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kitchenbot-provider-runner-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const samplesDir = path.join(root, 'samples');
  const workDir = path.join(root, 'work');
  const aliasesPath = path.join(root, 'aliases.json');
  await mkdir(samplesDir);
  await writeFile(aliasesPath, JSON.stringify(aliases));

  const samples = [
    descriptor('sample_001', '2 tacos al pastor', {
      items: [{ item: 'taco al pastor', quantity: 2, modifiers: [] }]
    }),
    descriptor('sample_002', '1 agua de horchata', {
      items: [{ item: 'agua de horchata', quantity: 1, modifiers: [] }]
    })
  ];

  for (const sample of samples) {
    const audioPath = path.join(samplesDir, sample.audio);
    const conditionsDir = path.join(workDir, sample.id);
    const telephonyPath = path.join(conditionsDir, 'telephony-16k.wav');
    await mkdir(conditionsDir, { recursive: true });
    await Promise.all([
      writeFile(audioPath, 'audio fixture'),
      writeFile(path.join(samplesDir, `${sample.id}.json`), JSON.stringify(sample)),
      writeFile(telephonyPath, 'telephony fixture')
    ]);
    await writeFile(path.join(conditionsDir, 'conditions.json'), JSON.stringify({
      version: 2,
      conditions: {
        A: { id: 'whatsapp', path: audioPath },
        C: { id: 'telephony-8k', path: telephonyPath }
      }
    }));
  }

  return { samplesDir, workDir, aliasesPath, samples };
}

function fakeConfig(enabled = true) {
  return {
    id: 'fake',
    enabled,
    language: 'es-MX',
    model: 'fixture-v1',
    credentialEnv: 'FAKE_CREDENTIAL_UNUSED'
  };
}

async function withoutNetwork(callback) {
  const originalConnect = Socket.prototype.connect;
  const originalFetch = globalThis.fetch;
  Socket.prototype.connect = () => {
    throw new Error('network access attempted');
  };
  globalThis.fetch = async () => {
    throw new Error('network access attempted');
  };

  try {
    return await callback();
  } finally {
    Socket.prototype.connect = originalConnect;
    globalThis.fetch = originalFetch;
  }
}

test('runs every sample x manifest condition x enabled provider without network', async (t) => {
  const fixtures = await createFixtures(t);
  const transcripts = Object.fromEntries(
    fixtures.samples.map((sample) => [sample.id, sample.transcript_literal])
  );

  const run = await withoutNetwork(() => runPoc({
    ...fixtures,
    providerConfigs: [
      fakeConfig(),
      {
        id: 'unregistered-disabled',
        enabled: false,
        language: 'es-MX',
        model: 'unused',
        credentialEnv: 'UNUSED'
      }
    ],
    providerOptions: { fake: { transcripts } },
    minSamples: 2
  }));

  assert.equal(run.failures.length, 0);
  assert.equal(run.results.length, 4);
  assert.deepEqual(
    run.results.map(({ sampleId, condition, provider }) => `${sampleId}:${condition}:${provider}`),
    [
      'sample_001:A:fake',
      'sample_001:C:fake',
      'sample_002:A:fake',
      'sample_002:C:fake'
    ]
  );

  for (const result of run.results) {
    const sample = fixtures.samples.find(({ id }) => id === result.sampleId);
    assert.equal(result.transcript, sample.transcript_literal);
    assert.equal(result.raw.transcript, result.transcript);
    assert.deepEqual(result.parsedOrder.items, sample.order_expected.items);
    assert.deepEqual(result.expectedOrder, sample.order_expected);
    assert.deepEqual(result.metrics, {
      order_accuracy: 1,
      item_deletion_rate: 0,
      field_error_rate: 0
    });
  }
});

test('retains per-request fake failures and continues remaining combinations', async (t) => {
  const fixtures = await createFixtures(t);
  const run = await withoutNetwork(() => runPoc({
    ...fixtures,
    providerConfigs: [fakeConfig()],
    providerOptions: {
      fake: { transcripts: { sample_002: fixtures.samples[1].transcript_literal } }
    },
    minSamples: 2
  }));

  assert.equal(run.results.length, 2);
  assert.equal(run.failures.length, 2);
  assert.deepEqual(
    run.failures.map(({ provider, sampleId, condition, errorCategory }) => ({
      provider,
      sampleId,
      condition,
      errorCategory
    })),
    [
      { provider: 'fake', sampleId: 'sample_001', condition: 'A', errorCategory: 'fixture' },
      { provider: 'fake', sampleId: 'sample_001', condition: 'C', errorCategory: 'fixture' }
    ]
  );
  assert.match(run.failures[0].message, /No fake transcript configured/);
  assert.deepEqual(
    run.results.map(({ sampleId, condition }) => `${sampleId}:${condition}`),
    ['sample_002:A', 'sample_002:C']
  );
});

test('scores an empty provider transcript as an item deletion', async (t) => {
  const fixtures = await createFixtures(t);
  const run = await withoutNetwork(() => runPoc({
    ...fixtures,
    providerConfigs: [fakeConfig()],
    providerOptions: {
      fake: {
        transcripts: {
          sample_001: '',
          sample_002: fixtures.samples[1].transcript_literal
        }
      }
    },
    minSamples: 2
  }));

  assert.equal(run.failures.length, 0);
  assert.deepEqual(run.results[0].metrics, {
    order_accuracy: 0,
    item_deletion_rate: 1,
    field_error_rate: 0
  });
});

test('validates credentialEnv when provider configuration includes it', () => {
  assert.throws(
    () => createEnabledProviders([{ ...fakeConfig(), credentialEnv: 42 }]),
    /credentialEnv must be a non-empty string/
  );
});
