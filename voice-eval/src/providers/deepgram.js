import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineProvider } from './provider.js';

const contentTypes = { '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

export function createDeepgramProvider(config, {
  boostVocabulary = [],
  fetch: request = fetch
} = {}) {
  const apiKey = process.env[config.credentialEnv];
  if (!apiKey) {
    throw new Error(`${config.credentialEnv} is not set`);
  }
  if (!Array.isArray(boostVocabulary) || !boostVocabulary.every((term) => typeof term === 'string' && term.trim())) {
    throw new TypeError('boostVocabulary must be an array of non-empty strings');
  }

  return defineProvider(config, async ({ audioPath, language, model }) => {
    const contentType = contentTypes[path.extname(audioPath).toLowerCase()];
    if (!contentType) {
      throw new Error(`Unsupported Deepgram audio format: ${audioPath}`);
    }

    const url = new URL('https://api.deepgram.com/v1/listen');
    url.search = new URLSearchParams({ model, language, punctuate: 'true', smart_format: 'true' });
    for (const term of boostVocabulary) {
      url.searchParams.append('keyterm', term);
    }
    const response = await request(url, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
      body: await readFile(audioPath)
    });
    const body = await response.text();
    if (!response.ok) {
      const error = new Error(`Deepgram HTTP ${response.status}: ${body}`);
      error.errorCategory = 'deepgram';
      throw error;
    }

    const raw = JSON.parse(body);
    return {
      transcript: raw.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '',
      provider: config.id,
      model,
      raw
    };
  });
}
