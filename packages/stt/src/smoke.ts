import { resolve } from "node:path";

import { createDeepgramProvider } from "./index.js";

if (process.env.STT_SMOKE !== "1") {
  throw new Error("Set STT_SMOKE=1 to authorize one paid transcription request");
}

const audioPath = process.env.STT_SMOKE_AUDIO_PATH;
if (!audioPath) {
  throw new Error("Set STT_SMOKE_AUDIO_PATH to the audio file to transcribe");
}

const result = await createDeepgramProvider().transcribe({
  audio: resolve(audioPath),
  mimeType: "audio/ogg",
  language: "es-419",
});

console.log(result.text);
