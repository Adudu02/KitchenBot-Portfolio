import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SpeechClient } from '@google-cloud/speech';
import { defineProvider } from './provider.js';

const audioConfigs = {
  '.ogg': { encoding: 'OGG_OPUS', sampleRateHertz: 48000 },
  '.wav': { encoding: 'LINEAR16', sampleRateHertz: 16000 }
};

export function createGoogleCloudProvider(config, {
  boostVocabulary = [],
  speechContextBoost = 20,
  client = new SpeechClient()
} = {}) {
  if (!process.env[config.credentialEnv]) {
    throw new Error(`${config.credentialEnv} is not set`);
  }
  if (!Array.isArray(boostVocabulary) || !boostVocabulary.every((term) => typeof term === 'string' && term.trim())) {
    throw new TypeError('boostVocabulary must be an array of non-empty strings');
  }
  if (boostVocabulary.length && (!(speechContextBoost > 0) || speechContextBoost > 20)) {
    throw new RangeError('speechContextBoost must be greater than 0 and at most 20');
  }

  return defineProvider(config, async ({ audioPath, language, model }) => {
    const audioConfig = audioConfigs[path.extname(audioPath).toLowerCase()];
    if (!audioConfig) {
      throw new Error(`Unsupported Google Cloud audio format: ${audioPath}`);
    }

    const [raw] = await client.recognize({
      config: {
        ...audioConfig,
        languageCode: language,
        model,
        enableAutomaticPunctuation: true,
        ...(boostVocabulary.length
          ? { speechContexts: [{ phrases: boostVocabulary, boost: speechContextBoost }] }
          : {})
      },
      audio: { content: (await readFile(audioPath)).toString('base64') }
    });

    return {
      transcript: (raw.results ?? [])
        .map((result) => result.alternatives?.[0]?.transcript ?? '')
        .filter(Boolean)
        .join(' '),
      provider: config.id,
      model,
      raw
    };
  });
}
