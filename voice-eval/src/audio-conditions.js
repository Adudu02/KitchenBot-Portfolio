import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(new Error(`Unable to start ${command}: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

export function telephonyMulawArguments(inputPath, outputPath) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-map', '0:a:0',
    '-ac', '1', '-ar', '8000',
    '-c:a', 'pcm_mulaw',
    outputPath
  ];
}

export function telephonyUpsampleArguments(inputPath, outputPath) {
  return [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-map', '0:a:0',
    '-ac', '1', '-ar', '16000',
    '-c:a', 'pcm_s16le',
    outputPath
  ];
}

export async function prepareAudioConditions({ inputPath, outputDir, ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg' }) {
  const whatsappPath = path.resolve(inputPath);
  await access(whatsappPath);
  const resolvedOutputDir = path.resolve(outputDir);
  await mkdir(resolvedOutputDir, { recursive: true });

  const scratchDir = path.join(resolvedOutputDir, 'scratch');
  const mulawPath = path.join(scratchDir, 'telephony-8k-mulaw.wav');
  const telephonyPath = path.join(resolvedOutputDir, 'telephony-16k.wav');

  await mkdir(scratchDir, { recursive: true });
  await run(ffmpegBin, telephonyMulawArguments(whatsappPath, mulawPath));
  await run(ffmpegBin, telephonyUpsampleArguments(mulawPath, telephonyPath));

  const manifestPath = path.join(resolvedOutputDir, 'conditions.json');
  const conditions = {
    A: { id: 'whatsapp', path: whatsappPath },
    C: { id: 'telephony-8k', path: telephonyPath }
  };
  await writeFile(manifestPath, `${JSON.stringify({ version: 2, conditions }, null, 2)}\n`);

  return {
    manifestPath,
    conditions,
    scratch: { telephonyMulawPath: mulawPath }
  };
}

export async function loadConditionsManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read conditions manifest at ${manifestPath}: ${error.message}`);
  }

  if (manifest?.version !== 2 || manifest.conditions === null || typeof manifest.conditions !== 'object') {
    throw new Error(`${manifestPath}: expected version 2 conditions manifest`);
  }

  const expectedConditions = { A: 'whatsapp', C: 'telephony-8k' };
  for (const [conditionId, expectedId] of Object.entries(expectedConditions)) {
    const condition = manifest.conditions[conditionId];
    if (!condition || condition.id !== expectedId || typeof condition.path !== 'string') {
      throw new Error(`${manifestPath}: condition ${conditionId} must be ${expectedId} with a file path`);
    }
    try {
      await access(condition.path);
    } catch {
      throw new Error(`${manifestPath}: condition ${conditionId} file does not exist at ${condition.path}`);
    }
  }

  return manifest;
}

export async function probeAudio(inputPath, { ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe' } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels',
      '-of', 'json', inputPath
    ];
    const child = spawn(ffprobeBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(new Error(`Unable to start ${ffprobeBin}: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${ffprobeBin} exited with ${code}: ${stderr.trim()}`));
        return;
      }
      const stream = JSON.parse(stdout).streams?.[0];
      if (!stream) {
        reject(new Error(`${inputPath}: no audio stream found`));
        return;
      }
      resolve(stream);
    });
  });
}
