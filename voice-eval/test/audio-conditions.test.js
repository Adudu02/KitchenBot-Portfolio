import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import {
  loadConditionsManifest,
  prepareAudioConditions,
  probeAudio
} from '../src/audio-conditions.js';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code}`));
    });
  });
}

test('keeps the WhatsApp source and creates its telephony condition', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kitchenbot-poc-audio-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, 'whatsapp-source.ogg');
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.2',
    '-ac', '1', '-ar', '16000', '-c:a', 'libopus', sourcePath
  ]);

  const conditions = await prepareAudioConditions({
    inputPath: sourcePath,
    outputDir: path.join(root, 'conditions')
  });
  const manifest = await loadConditionsManifest(conditions.manifestPath);
  const [whatsapp, mulaw, telephony] = await Promise.all([
    probeAudio(manifest.conditions.A.path),
    probeAudio(conditions.scratch.telephonyMulawPath),
    probeAudio(manifest.conditions.C.path)
  ]);

  assert.deepEqual(Object.keys(manifest.conditions), ['A', 'C']);
  assert.equal(path.dirname(conditions.scratch.telephonyMulawPath), path.join(root, 'conditions', 'scratch'));
  assert.equal(manifest.conditions.A.path, sourcePath);
  assert.equal(manifest.conditions.A.id, 'whatsapp');
  assert.equal(whatsapp.codec_name, 'opus');
  assert.equal(whatsapp.channels, 1);
  assert.equal(manifest.conditions.C.id, 'telephony-8k');
  assert.deepEqual(mulaw, { codec_name: 'pcm_mulaw', sample_rate: '8000', channels: 1 });
  assert.deepEqual(telephony, { codec_name: 'pcm_s16le', sample_rate: '16000', channels: 1 });
});

test('uses conditions.json as the only condition source and ignores unlisted files', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kitchenbot-poc-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, 'conditions');
  await run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=0.2',
    '-ac', '1', '-ar', '16000', '-c:a', 'libopus', path.join(root, 'whatsapp-source.ogg')
  ]);

  const prepared = await prepareAudioConditions({
    inputPath: path.join(root, 'whatsapp-source.ogg'),
    outputDir
  });
  const decoyPath = path.join(outputDir, 'unlisted-extra.wav');
  await writeFile(decoyPath, 'not a condition');
  const manifest = await loadConditionsManifest(prepared.manifestPath);
  const manifestPaths = Object.values(manifest.conditions).map((condition) => condition.path);

  assert.deepEqual(Object.keys(manifest.conditions), ['A', 'C']);
  assert.equal(manifestPaths.length, 2);
  assert.equal(manifestPaths.includes(decoyPath), false);
  assert.equal(manifest.conditions.A.path, path.join(root, 'whatsapp-source.ogg'));
  assert.equal(manifest.conditions.C.path.startsWith(`${outputDir}${path.sep}`), true);
});
