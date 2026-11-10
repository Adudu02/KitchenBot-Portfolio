import { prepareAudioConditions } from './audio-conditions.js';

const [inputPath, outputDir] = process.argv.slice(2);
if (!inputPath || !outputDir) {
  throw new Error('Usage: node src/prepare-audio.js <input-audio> <output-dir>');
}

const conditions = await prepareAudioConditions({ inputPath, outputDir });
console.log(JSON.stringify(conditions, null, 2));
