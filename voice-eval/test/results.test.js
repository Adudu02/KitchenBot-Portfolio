import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { aggregateResults } from '../src/aggregate-results.js';
import { main } from '../src/cli.js';
import { compareRuns } from '../src/compare-runs.js';
import { runPoc } from '../src/run.js';
import { writeResults } from '../src/write-results.js';

const aliases = {
  'taco al pastor': ['tacos al pastor'],
  'agua de horchata': ['horchata'],
  grande: ['grandes']
};

const providerConfigs = [{
  id: 'fake',
  enabled: true,
  language: 'es-MX',
  model: 'fixture-v1',
  credentialEnv: 'FAKE_CREDENTIAL_UNUSED'
}];

function descriptor(id, expected) {
  return {
    id,
    audio: `${id}.ogg`,
    speaker: 'fixture',
    noise: 'none',
    transcript_literal: '',
    order_expected: expected
  };
}

async function createFixtures(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kitchenbot-results-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const samplesDir = path.join(root, 'samples');
  const workDir = path.join(root, 'work');
  const resultsDir = path.join(root, 'results');
  const aliasesPath = path.join(root, 'aliases.json');
  await mkdir(samplesDir);
  await writeFile(aliasesPath, JSON.stringify(aliases));

  const samples = [
    descriptor('sample_001', {
      items: [
        { item: 'taco al pastor', quantity: 2, modifiers: [] },
        { item: 'agua de horchata', quantity: 1, modifiers: [] }
      ]
    }),
    descriptor('sample_002', {
      items: [
        { item: 'taco al pastor', quantity: 2, modifiers: [] },
        { item: 'agua de horchata', quantity: 1, modifiers: [] }
      ]
    }),
    descriptor('sample_003', {
      items: [{ item: 'taco al pastor', quantity: 1, modifiers: ['grande'] }]
    })
  ];

  for (const sample of samples) {
    const audioPath = path.join(samplesDir, sample.audio);
    const conditionDir = path.join(workDir, sample.id);
    const telephonyPath = path.join(conditionDir, 'telephony-16k.wav');
    await mkdir(conditionDir, { recursive: true });
    await Promise.all([
      writeFile(audioPath, 'audio fixture'),
      writeFile(path.join(samplesDir, `${sample.id}.json`), JSON.stringify(sample)),
      writeFile(telephonyPath, 'telephony fixture')
    ]);
    await writeFile(path.join(conditionDir, 'conditions.json'), JSON.stringify({
      version: 2,
      conditions: {
        A: { id: 'whatsapp', path: audioPath },
        C: { id: 'telephony-8k', path: telephonyPath }
      }
    }));
  }

  return { root, samplesDir, workDir, resultsDir, aliasesPath };
}

function runFixtures(fixtures, transcripts) {
  return runPoc({
    ...fixtures,
    providerConfigs,
    providerOptions: { fake: { transcripts } },
    minSamples: 3
  });
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

test('persists, aggregates, and compares complete fake runs without network', async (t) => {
  const fixtures = await createFixtures(t);
  const firstTranscripts = {
    sample_001: '2 tacos al pastor y 1 agua de horchata',
    sample_002: '3 tacos al pastor y 1 agua de horchata',
    sample_003: '2 agua de horchata'
  };
  const secondTranscripts = { ...firstTranscripts, sample_001: '' };

  const [firstRun, secondRun] = await withoutNetwork(async () => [
    await runFixtures(fixtures, firstTranscripts),
    await runFixtures(fixtures, secondTranscripts)
  ]);
  const aggregates = aggregateResults(firstRun.results);
  const whatsapp = aggregates.find(({ provider, condition }) => (
    provider === 'fake' && condition === 'A'
  ));

  assert.deepEqual(whatsapp.metrics, {
    order_accuracy: 1 / 3,
    item_deletion_rate: 0,
    field_error_rate: 4 / 15
  });
  assert.deepEqual(whatsapp.counts, {
    orders: 3,
    correctOrders: 1,
    ordersWithDeletion: 0,
    fieldErrors: 4,
    fieldsCompared: 15
  });
  assert.notEqual(whatsapp.metrics.field_error_rate, (
    firstRun.results
      .filter(({ condition }) => condition === 'A')
      .reduce((sum, result) => sum + result.metrics.field_error_rate, 0) / 3
  ));

  const firstWrite = await writeResults(firstRun, { resultsDir: fixtures.resultsDir });
  const secondWrite = await writeResults(secondRun, { resultsDir: fixtures.resultsDir });
  assert.notEqual(firstWrite.runId, secondWrite.runId);
  assert.notEqual(firstWrite.path, secondWrite.path);
  await Promise.all([access(firstWrite.path), access(secondWrite.path)]);

  const persisted = JSON.parse(await readFile(firstWrite.path, 'utf8'));
  assert.equal(persisted.run.id, firstWrite.runId);
  assert.match(persisted.run.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(persisted.providers, providerConfigs);
  assert.equal(persisted.conditions.length, 6);
  assert.deepEqual(Object.keys(persisted.conditions[0]).sort(), [
    'condition',
    'id',
    'path',
    'sampleId'
  ]);
  assert.equal(persisted.results.length, 6);
  assert.equal(persisted.aggregates.length, 2);
  for (const result of persisted.results) {
    assert.equal(typeof result.transcript, 'string');
    assert.equal(result.raw.source, 'fixture');
    assert.equal(typeof result.conditionMetadata.id, 'string');
    assert.equal(typeof result.conditionMetadata.path, 'string');
    assert.ok(result.parsedOrder);
    assert.ok(result.expectedOrder);
    assert.deepEqual(Object.keys(result.differences).sort(), [
      'deletions',
      'insertions',
      'substitutions'
    ]);
    assert.deepEqual(Object.keys(result.metrics).sort(), [
      'field_error_rate',
      'item_deletion_rate',
      'order_accuracy'
    ]);
  }

  const comparison = await compareRuns(firstWrite.runId, secondWrite.path, {
    resultsDir: fixtures.resultsDir
  });
  assert.equal(comparison.sources.left.run.id, firstWrite.runId);
  assert.equal(comparison.sources.right.run.id, secondWrite.runId);
  assert.equal(comparison.sources.left.results.length, 6);
  assert.equal(comparison.sources.right.results.length, 6);
  const sampleChange = comparison.sampleChanges.find(({ provider, condition, sampleId }) => (
    provider === 'fake' && condition === 'A' && sampleId === 'sample_001'
  ));
  assert.equal(sampleChange.left.metrics.item_deletion_rate, 0);
  assert.equal(sampleChange.right.metrics.item_deletion_rate, 1);
  assert.equal(sampleChange.right.differences.deletions.length, 2);
  assert.equal(sampleChange.right.differences.substitutions.length, 0);
  const groupChange = comparison.metricComparisons.find(({ provider, condition }) => (
    provider === 'fake' && condition === 'A'
  ));
  assert.deepEqual(groupChange.left, {
    order_accuracy: 1 / 3,
    item_deletion_rate: 0,
    field_error_rate: 4 / 15
  });
  assert.deepEqual(groupChange.right, {
    order_accuracy: 0,
    item_deletion_rate: 1 / 3,
    field_error_rate: 4 / 9
  });
});

test('CLI runs fixtures through fake, persists the run, and prints aggregates', async (t) => {
  const fixtures = await createFixtures(t);
  const configPath = path.join(fixtures.root, 'config.json');
  const transcripts = {
    sample_001: '2 tacos al pastor y 1 agua de horchata',
    sample_002: '3 tacos al pastor y 1 agua de horchata',
    sample_003: '2 agua de horchata'
  };
  await writeFile(configPath, JSON.stringify({
    corpusDir: './samples',
    aliasesPath: './aliases.json',
    workDir: './work',
    providers: providerConfigs,
    providerOptions: { fake: { transcripts } }
  }));
  const tables = [];
  const output = {
    log() {},
    table(rows) {
      tables.push(rows);
    }
  };

  const written = await withoutNetwork(() => main({
    configPath,
    resultsDir: fixtures.resultsDir,
    minSamples: 3,
    output
  }));

  await access(written.path);
  assert.equal(tables.length, 1);
  assert.equal(tables[0].length, 2);
  assert.deepEqual(Object.keys(tables[0][0]).sort(), [
    'condition',
    'field_error_rate',
    'item_deletion_rate',
    'order_accuracy',
    'provider'
  ]);

  const packageJson = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  );
  assert.equal(packageJson.scripts['run:poc'], 'node src/cli.js');
});
