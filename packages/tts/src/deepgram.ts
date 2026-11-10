import {
  synthesisInputSchema,
  type SynthesisResult,
  type TextToSpeechProvider,
} from "./contract.js";
import {
  TtsAuthError,
  TtsEmptyResultError,
  TtsProviderError,
  TtsRateLimitError,
} from "./errors.js";

const DEFAULT_DEEPGRAM_TTS_URL = "https://api.deepgram.com/v1/speak";
const PROVIDER = "deepgram";

// Deepgram Aura encodes language in the voice model, not a separate param.
const DEFAULT_MODEL = "aura-2-celeste-es";
const DEFAULT_VOICES: Record<string, string> = {
  es: DEFAULT_MODEL,
  en: "aura-asteria-en",
};
const DEFAULT_LANGUAGE = "es";

// Aura output formats. opus uses the ogg container (its default) at a fixed 48 kHz
// — this is what WhatsApp voice notes (ptt) require.
const FORMATS = {
  mp3: { encoding: "mp3", mimeType: "audio/mpeg" },
  // WhatsApp ptt voice notes need the full "codecs=opus" mimetype to render.
  ogg_opus: { encoding: "opus", mimeType: "audio/ogg; codecs=opus" },
} as const;
const DEFAULT_FORMAT = "mp3";

export interface DeepgramTtsProviderOptions {
  fetch?: typeof globalThis.fetch;
}

export function createDeepgramTtsProvider(
  { fetch: request = globalThis.fetch }: DeepgramTtsProviderOptions = {},
): TextToSpeechProvider {
  return {
    async synthesize(unvalidatedInput): Promise<SynthesisResult> {
      const input = synthesisInputSchema.parse(unvalidatedInput);

      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        throw new TtsAuthError(PROVIDER);
      }

      const language = input.language ?? DEFAULT_LANGUAGE;
      const model = input.voice ?? DEFAULT_VOICES[language] ?? DEFAULT_MODEL;

      const formatKey = input.format ?? DEFAULT_FORMAT;
      const format = FORMATS[formatKey];

      const url = new URL(
        process.env.DEEPGRAM_TTS_URL ?? DEFAULT_DEEPGRAM_TTS_URL,
      );
      url.searchParams.set("model", model);
      url.searchParams.set("encoding", format.encoding);

      let response: Response;
      try {
        response = await request(url, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: input.text }),
        });
      } catch (cause) {
        throw new TtsProviderError(PROVIDER, undefined, cause);
      }

      if (response.status === 401 || response.status === 403) {
        throw new TtsAuthError(PROVIDER);
      }
      if (response.status === 429) {
        throw new TtsRateLimitError(PROVIDER);
      }
      if (!response.ok) {
        throw new TtsProviderError(PROVIDER, response.status);
      }

      let audio: Buffer;
      try {
        audio = Buffer.from(await response.arrayBuffer());
      } catch (cause) {
        throw new TtsProviderError(PROVIDER, undefined, cause);
      }

      if (audio.length === 0) {
        throw new TtsEmptyResultError(PROVIDER);
      }

      // Opus output is always ogg/opus; Deepgram's header drops the codecs param
      // that WhatsApp ptt needs, so use our known-correct value instead of it.
      const mimeType = formatKey === "ogg_opus"
        ? format.mimeType
        : response.headers.get("content-type")?.trim() || format.mimeType;

      return {
        audio,
        mimeType,
        provider: PROVIDER,
        model,
        raw: {
          requestId: response.headers.get("dg-request-id"),
          charCount: response.headers.get("dg-char-count"),
          modelName: response.headers.get("dg-model-name"),
        },
      };
    },
  };
}
