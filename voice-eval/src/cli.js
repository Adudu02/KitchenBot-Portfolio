import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { runPoc } from './run.js';
import { writeResults } from './write-results.js';

export async function main({
  configPath,
  resultsDir,
  minSamples = 20,
  output = console
} = {}) {
  const config = await loadConfig(configPath);
  const run = await runPoc({
    samplesDir: config.corpusDir,
    aliasesPath: config.aliasesPath,
    workDir: config.workDir,
    providerConfigs: config.providers,
    providerOptions: config.providerOptions,
    minSamples
  });
  const written = await writeResults(run, { resultsDir });
  output.log(`Run ${written.runId} written to ${written.path}`);
  output.table(written.data.aggregates.map(({ provider, condition, metrics }) => ({
    provider,
    condition,
    ...metrics
  })));
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ configPath: process.argv[2] }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
