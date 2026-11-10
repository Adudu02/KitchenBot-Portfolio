import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDeepgramProvider } from '../src/providers/deepgram.js';
import { createGoogleCloudProvider } from '../src/providers/google-cloud.js';

const request = {
  language: 'es-MX',
  model: 'fixture-model',
  sampleId: 'sample_fixture',
  condition: 'C'
};

async function audioFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'kitchenbot-boost-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const audioPath = path.join(directory, 'fixture.wav');
  await writeFile(audioPath, 'audio');
  return audioPath;
}

test('Deepgram sends repeated keyterm values only when vocabulary is supplied', async (t) => {
  process.env.TEST_DEEPGRAM_KEY = 'not-a-real-key';
  t.after(() => delete process.env.TEST_DEEPGRAM_KEY);
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: '' }] }] } });
      }
    };
  };
  const config = { id: 'deepgram', credentialEnv: 'TEST_DEEPGRAM_KEY' };
  const audioPath = await audioFixture(t);

  await createDeepgramProvider(config, {
    boostVocabulary: ['orden de sopa', 'bbq'],
    fetch
  }).transcribe({ ...request, audioPath });
  await createDeepgramProvider(config, { fetch }).transcribe({ ...request, audioPath });

  assert.deepEqual(urls[0].searchParams.getAll('keyterm'), ['orden de sopa', 'bbq']);
  assert.equal(urls[0].searchParams.has('keywords'), false);
  assert.equal(urls[1].searchParams.has('keyterm'), false);
});

test('Google sends speechContexts only when vocabulary is supplied', async (t) => {
  process.env.TEST_GOOGLE_CREDENTIALS = 'present';
  t.after(() => delete process.env.TEST_GOOGLE_CREDENTIALS);
  const requests = [];
  const client = {
    async recognize(value) {
      requests.push(value);
      return [{ results: [] }];
    }
  };
  const config = { id: 'google-cloud', credentialEnv: 'TEST_GOOGLE_CREDENTIALS' };
  const audioPath = await audioFixture(t);

  await createGoogleCloudProvider(config, {
    boostVocabulary: ['orden de sopa', 'bbq'],
    speechContextBoost: 20,
    client
  }).transcribe({ ...request, audioPath });
  await createGoogleCloudProvider(config, { client }).transcribe({ ...request, audioPath });

  assert.deepEqual(requests[0].config.speechContexts, [{
    phrases: ['orden de sopa', 'bbq'],
    boost: 20
  }]);
  assert.equal(Object.hasOwn(requests[1].config, 'speechContexts'), false);
});
