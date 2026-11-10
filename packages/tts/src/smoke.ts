import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createDeepgramTtsProvider } from "./index.js";

if (process.env.TTS_SMOKE !== "1") {
  throw new Error("Set TTS_SMOKE=1 to authorize one paid synthesis request");
}

const text = process.env.TTS_SMOKE_TEXT
  ?? "Hola, tu pedido es dos tacos al pastor y una jamaica.";
const outputPath = resolve(process.env.TTS_SMOKE_OUTPUT_PATH ?? "tts-smoke.mp3");

const result = await createDeepgramTtsProvider().synthesize({ text });

await writeFile(outputPath, result.audio);
console.log(
  `${result.provider}/${result.model} → ${result.audio.length} bytes ${result.mimeType} @ ${outputPath}`,
);
