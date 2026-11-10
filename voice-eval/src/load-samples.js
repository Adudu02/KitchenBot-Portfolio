import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateAliases, validateSample } from './contract.js';

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read JSON at ${filePath}: ${error.message}`);
  }
}

export async function loadAliases(aliasesPath) {
  return validateAliases(await readJson(aliasesPath), aliasesPath);
}

export async function loadSamples(samplesDir, { minSamples = 20 } = {}) {
  const files = (await readdir(samplesDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort();

  if (files.length < minSamples) {
    throw new Error(`${samplesDir}: expected at least ${minSamples} sample JSON files, found ${files.length}`);
  }

  const seenIds = new Set();
  const samples = [];

  for (const fileName of files) {
    const sourcePath = path.join(samplesDir, fileName);
    const sample = validateSample(await readJson(sourcePath), sourcePath);
    if (seenIds.has(sample.id)) {
      throw new Error(`${sourcePath}: duplicate sample id ${sample.id}`);
    }
    seenIds.add(sample.id);

    const audioPath = path.resolve(path.dirname(sourcePath), sample.audio);
    try {
      const audioStat = await stat(audioPath);
      if (!audioStat.isFile()) {
        throw new Error('not a file');
      }
    } catch {
      throw new Error(`${sourcePath}: audio file does not exist at ${audioPath}`);
    }

    samples.push({ ...sample, sourcePath, audioPath });
  }

  return samples;
}

export async function assertFileExists(filePath) {
  try {
    await access(filePath);
  } catch {
    throw new Error(`Audio file does not exist at ${filePath}`);
  }
}
