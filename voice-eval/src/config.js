import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pocDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function requireString(value, field, configPath) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${configPath}: ${field} must be a non-empty string`);
  }

  return value;
}

export async function loadConfig(configPath = process.env.POC_CONFIG_PATH || path.join(pocDirectory, 'config.json')) {
  let parsed;

  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read POC config at ${configPath}: ${error.message}`);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error(`${configPath}: config must be a JSON object`);
  }

  if (parsed.providers !== undefined && !Array.isArray(parsed.providers)) {
    throw new Error(`${configPath}: providers must be an array`);
  }

  const configDirectory = path.dirname(path.resolve(configPath));
  return {
    ...parsed,
    configPath: path.resolve(configPath),
    corpusDir: path.resolve(configDirectory, requireString(parsed.corpusDir, 'corpusDir', configPath)),
    aliasesPath: path.resolve(configDirectory, requireString(parsed.aliasesPath, 'aliasesPath', configPath)),
    workDir: path.resolve(configDirectory, requireString(parsed.workDir, 'workDir', configPath)),
    providers: parsed.providers || []
  };
}
