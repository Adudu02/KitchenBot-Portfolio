import { loadConfig } from './config.js';
import { loadAliases, loadSamples } from './load-samples.js';

const config = await loadConfig();
const [aliases, samples] = await Promise.all([
  loadAliases(config.aliasesPath),
  loadSamples(config.corpusDir)
]);

console.log(`Validated ${samples.length} samples and ${Object.keys(aliases).length} alias entries.`);
