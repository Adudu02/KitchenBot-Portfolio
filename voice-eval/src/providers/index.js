import { createDeepgramProvider } from './deepgram.js';
import { createFakeProvider } from './fake.js';
import { createGoogleCloudProvider } from './google-cloud.js';

const defaultRegistry = new Map([
  ['fake', createFakeProvider],
  ['deepgram', createDeepgramProvider],
  ['google-cloud', createGoogleCloudProvider]
]);

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

export function validateProviderConfig(config, index = 0) {
  const label = `providers[${index}]`;
  if (config === null || Array.isArray(config) || typeof config !== 'object') {
    throw new TypeError(`${label} must be an object`);
  }

  requireString(config.id, `${label}.id`);
  if (typeof config.enabled !== 'boolean') {
    throw new TypeError(`${label}.enabled must be a boolean`);
  }
  requireString(config.language, `${label}.language`);
  requireString(config.model, `${label}.model`);
  if (config.credentialEnv !== undefined) {
    requireString(config.credentialEnv, `${label}.credentialEnv`);
  }

  return { ...config, credentialEnv: config.credentialEnv ?? null };
}

export function createEnabledProviders(configs, {
  registry = defaultRegistry,
  optionsById = {}
} = {}) {
  if (!Array.isArray(configs)) {
    throw new TypeError('providers must be an array');
  }

  const validated = configs.map(validateProviderConfig);
  const ids = new Set();
  for (const config of validated) {
    if (ids.has(config.id)) {
      throw new Error(`duplicate provider id ${config.id}`);
    }
    ids.add(config.id);
  }

  return validated
    .filter(({ enabled }) => enabled)
    .map((config) => {
      const factory = registry.get(config.id);
      if (!factory) {
        throw new Error(`No adapter registered for enabled provider ${config.id}`);
      }
      return factory(config, optionsById[config.id]);
    });
}
