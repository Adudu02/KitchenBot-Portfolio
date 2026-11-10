import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateResults } from './aggregate-results.js';

const pocDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function newRunMetadata() {
  const timestamp = new Date().toISOString();
  const id = `${timestamp.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
  return { id, timestamp };
}

export async function writeResults(runOutput, {
  resultsDir = path.join(pocDirectory, 'results')
} = {}) {
  if (!Array.isArray(runOutput?.results)) {
    throw new TypeError('runOutput.results must be an array');
  }
  if (!Array.isArray(runOutput.providerConfigs)) {
    throw new TypeError('runOutput.providerConfigs must be an array');
  }
  if (!Array.isArray(runOutput.conditions)) {
    throw new TypeError('runOutput.conditions must be an array');
  }

  await mkdir(resultsDir, { recursive: true });
  while (true) {
    const run = newRunMetadata();
    const data = {
      schemaVersion: 1,
      run,
      providers: runOutput.providerConfigs,
      conditions: runOutput.conditions,
      results: runOutput.results,
      failures: runOutput.failures || [],
      aggregates: aggregateResults(runOutput.results)
    };
    const outputPath = path.join(resultsDir, `${run.id}.json`);

    try {
      await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx'
      });
      return { runId: run.id, path: outputPath, data };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}
