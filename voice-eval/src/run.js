import path from 'node:path';
import { loadConditionsManifest } from './audio-conditions.js';
import { loadAliases, loadSamples } from './load-samples.js';
import { parseOrder } from './parse-order.js';
import { createEnabledProviders } from './providers/index.js';
import { scoreOrder } from './score-order.js';

function failureFor(error, provider, sampleId, condition) {
  return {
    provider: provider.id,
    sampleId,
    condition,
    errorCategory: error?.errorCategory || error?.name || 'Error',
    message: error?.message || String(error)
  };
}

export async function runPoc({
  samplesDir,
  aliasesPath,
  workDir,
  providerConfigs,
  providerRegistry,
  providerOptions,
  minSamples = 20
}) {
  const [samples, aliases] = await Promise.all([
    loadSamples(samplesDir, { minSamples }),
    loadAliases(aliasesPath)
  ]);
  const providers = createEnabledProviders(providerConfigs, {
    registry: providerRegistry,
    optionsById: providerOptions
  });
  const results = [];
  const failures = [];
  const conditions = [];

  for (const sample of samples) {
    const manifest = await loadConditionsManifest(
      path.join(workDir, sample.id, 'conditions.json')
    );

    for (const [condition, conditionConfig] of Object.entries(manifest.conditions)) {
      conditions.push({ sampleId: sample.id, condition, ...conditionConfig });
      for (const provider of providers) {
        try {
          const response = await provider.transcribe({
            audioPath: conditionConfig.path,
            language: provider.config.language,
            model: provider.config.model,
            sampleId: sample.id,
            condition
          });
          const parsedOrder = parseOrder(response.transcript, { aliases });
          const score = scoreOrder(parsedOrder, sample.order_expected, { aliases });

          results.push({
            provider: response.provider,
            model: response.model,
            sampleId: sample.id,
            condition,
            conditionMetadata: conditionConfig,
            transcript: response.transcript,
            raw: response.raw,
            parsedOrder,
            expectedOrder: sample.order_expected,
            metrics: score.metrics,
            differences: score.differences,
            counts: score.counts
          });
        } catch (error) {
          failures.push(failureFor(error, provider, sample.id, condition));
        }
      }
    }
  }

  return {
    providerConfigs: providers.map(({ config }) => config),
    conditions,
    results,
    failures
  };
}
