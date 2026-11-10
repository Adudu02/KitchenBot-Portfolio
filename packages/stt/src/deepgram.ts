import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  transcriptionInputSchema,
  type SpeechToTextProvider,
  type TranscriptionResult,
} from "./contract.js";
import {
  SttAuthError,
  SttError,
  SttEmptyResultError,
  SttProviderError,
  SttRateLimitError,
  SttUnsupportedFormatError,
  SttVocabularyLimitError,
} from "./errors.js";

const DEFAULT_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const PROVIDER = "deepgram";
const MODEL = "nova-3";
const SUPPORTED_MIME_TYPES = new Set(["audio/ogg", "audio/wav"]);

export const DEEPGRAM_KEYTERM_TOKEN_LIMIT = 500;
const DEEPGRAM_KEYTERM_EFFECTIVE_TOKEN_LIMIT = 400;
const DEEPGRAM_KEYTERM_BYTE_LIMIT = 4_000;

const responseSchema = z.object({
  results: z.object({
    channels: z.array(z.object({
      alternatives: z.array(z.object({ transcript: z.string() })),
    })),
  }),
});

export interface DeepgramProviderOptions {
  fetch?: typeof globalThis.fetch;
}

function countVocabularyWords(hints: string[]): number {
  return hints.reduce(
    (total, hint) => total + hint.split(/\s+/u).filter(Boolean).length,
    0,
  );
}

export function createDeepgramProvider(
  { fetch: request = globalThis.fetch }: DeepgramProviderOptions = {},
): SpeechToTextProvider {
  return {
    async transcribe(unvalidatedInput): Promise<TranscriptionResult> {
      const input = transcriptionInputSchema.parse(unvalidatedInput);
      if (!SUPPORTED_MIME_TYPES.has(input.mimeType)) {
        throw new SttUnsupportedFormatError(input.mimeType);
      }

      const vocabularyHints = input.vocabularyHints ?? [];
      /**
       * Deepgram does not publish an exact client-side token-counting algorithm;
       * this is a conservative approximation with a safety margin, not a
       * verified equivalent count. The 400-word threshold leaves 20% headroom
       * below the documented limit, while the independent 4,000-byte ceiling
       * bounds unusually long UTF-8 input rather than estimating token count.
       */
      const approximateTokenCount = countVocabularyWords(vocabularyHints);
      if (approximateTokenCount > DEEPGRAM_KEYTERM_EFFECTIVE_TOKEN_LIMIT) {
        throw new SttVocabularyLimitError(
          approximateTokenCount,
          DEEPGRAM_KEYTERM_EFFECTIVE_TOKEN_LIMIT,
        );
      }
      const vocabularyByteLength = Buffer.byteLength(
        vocabularyHints.join(" "),
        "utf8",
      );
      if (vocabularyByteLength > DEEPGRAM_KEYTERM_BYTE_LIMIT) {
        throw new SttError(
          "VOCABULARY_LIMIT",
          `Vocabulary hints exceed the conservative ${DEEPGRAM_KEYTERM_BYTE_LIMIT}-byte safety limit (${vocabularyByteLength} supplied)`,
        );
      }

      const apiKey = process.env.DEEPGRAM_API_KEY;
      if (!apiKey) {
        throw new SttAuthError(PROVIDER);
      }

      const url = new URL(process.env.DEEPGRAM_API_URL ?? DEFAULT_DEEPGRAM_URL);
      url.searchParams.set("model", MODEL);
      url.searchParams.set("language", input.language);
      for (const hint of vocabularyHints) {
        url.searchParams.append("keyterm", hint);
      }

      let response: Response;
      try {
        response = await request(url, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            "Content-Type": input.mimeType,
          },
          body: typeof input.audio === "string"
            ? await readFile(input.audio)
            : input.audio,
        });
      } catch (cause) {
        throw new SttProviderError(PROVIDER, undefined, cause);
      }

      if (response.status === 401 || response.status === 403) {
        throw new SttAuthError(PROVIDER);
      }
      if (response.status === 429) {
        throw new SttRateLimitError(PROVIDER);
      }
      if (!response.ok) {
        throw new SttProviderError(PROVIDER, response.status);
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch (cause) {
        throw new SttProviderError(PROVIDER, undefined, cause);
      }

      const parsed = responseSchema.safeParse(raw);
      const text = parsed.success
        ? parsed.data.results.channels[0]?.alternatives[0]?.transcript
        : undefined;
      if (text === undefined) {
        if (parsed.success) {
          throw new SttEmptyResultError(PROVIDER);
        }
        throw new SttProviderError(PROVIDER);
      }

      return { text, provider: PROVIDER, model: MODEL, raw };
    },
  };
}
