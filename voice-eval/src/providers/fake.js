import { defineProvider } from './provider.js';

export function createFakeProvider(config, { transcripts = {} } = {}) {
  return defineProvider(config, async ({ sampleId, model }) => {
    if (!Object.hasOwn(transcripts, sampleId)) {
      const error = new Error(`No fake transcript configured for ${sampleId}`);
      error.errorCategory = 'fixture';
      throw error;
    }

    const transcript = transcripts[sampleId];
    return {
      transcript,
      provider: config.id,
      model,
      raw: { source: 'fixture', sampleId, transcript }
    };
  });
}
