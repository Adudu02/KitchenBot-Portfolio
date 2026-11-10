import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDeepgramTtsProvider,
  TtsAuthError,
  TtsEmptyResultError,
  TtsProviderError,
  TtsRateLimitError,
  type SynthesisInput,
} from "./index.js";

const input: SynthesisInput = {
  text: "Quiero dos tacos",
};

function audioResponse(
  bytes: Uint8Array,
  status = 200,
  headers: Record<string, string> = { "Content-Type": "audio/mpeg" },
): Response {
  return new Response(bytes.byteLength === 0 ? null : bytes, { status, headers });
}

const sampleAudio = new Uint8Array([0x49, 0x44, 0x33, 0x04]);

describe("Deepgram TTS provider", () => {
  const previousApiKey = process.env.DEEPGRAM_API_KEY;
  const previousApiUrl = process.env.DEEPGRAM_TTS_URL;

  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = "test-key";
    delete process.env.DEEPGRAM_TTS_URL;
  });

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env.DEEPGRAM_API_KEY;
    } else {
      process.env.DEEPGRAM_API_KEY = previousApiKey;
    }
    if (previousApiUrl === undefined) {
      delete process.env.DEEPGRAM_TTS_URL;
    } else {
      process.env.DEEPGRAM_TTS_URL = previousApiUrl;
    }
  });

  it("returns audio bytes, mime type, and provider metadata", async () => {
    const request: typeof fetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("Content-Type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({ text: "Quiero dos tacos" });
      return audioResponse(sampleAudio);
    };

    const result = await createDeepgramTtsProvider({ fetch: request }).synthesize(input);
    expect(result).toMatchObject({
      mimeType: "audio/mpeg",
      provider: "deepgram",
      model: "aura-2-celeste-es",
    });
    expect(Buffer.from(sampleAudio).equals(result.audio)).toBe(true);
  });

  it("defaults to the Spanish voice model when none is given", async () => {
    let requestedUrl = "";
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return audioResponse(sampleAudio);
    };

    await createDeepgramTtsProvider({ fetch: request }).synthesize(input);
    expect(new URL(requestedUrl).searchParams.get("model")).toBe("aura-2-celeste-es");
    expect(new URL(requestedUrl).searchParams.get("encoding")).toBe("mp3");
  });

  it("requests opus/ogg and reports the full codecs mimetype WhatsApp ptt needs", async () => {
    let requestedUrl = "";
    // Deepgram returns a plain "audio/ogg" header, missing "; codecs=opus".
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return audioResponse(sampleAudio, 200, { "Content-Type": "audio/ogg" });
    };

    const result = await createDeepgramTtsProvider({ fetch: request }).synthesize({
      ...input,
      format: "ogg_opus",
    });
    expect(new URL(requestedUrl).searchParams.get("encoding")).toBe("opus");
    expect(result.mimeType).toBe("audio/ogg; codecs=opus");
  });

  it("uses an explicit voice override over the language default", async () => {
    let requestedUrl = "";
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return audioResponse(sampleAudio);
    };

    const result = await createDeepgramTtsProvider({ fetch: request }).synthesize({
      ...input,
      language: "es",
      voice: "aura-asteria-en",
    });
    expect(new URL(requestedUrl).searchParams.get("model")).toBe("aura-asteria-en");
    expect(result.model).toBe("aura-asteria-en");
  });

  it("uses the production Deepgram URL when the override is unset", async () => {
    let requestedUrl = "";
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return audioResponse(sampleAudio);
    };

    await createDeepgramTtsProvider({ fetch: request }).synthesize(input);
    const url = new URL(requestedUrl);
    expect(url.origin + url.pathname).toBe("https://api.deepgram.com/v1/speak");
  });

  it("falls back to audio/mpeg when the response omits a content type", async () => {
    const request: typeof fetch = async () => audioResponse(sampleAudio, 200, {});

    const result = await createDeepgramTtsProvider({ fetch: request }).synthesize(input);
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("requires an API key before sending a request", async () => {
    delete process.env.DEEPGRAM_API_KEY;
    let requestCount = 0;
    const request: typeof fetch = async () => {
      requestCount += 1;
      return audioResponse(sampleAudio);
    };

    await expect(createDeepgramTtsProvider({ fetch: request }).synthesize(input))
      .rejects.toBeInstanceOf(TtsAuthError);
    expect(requestCount).toBe(0);
  });

  it("maps HTTP 401 to a typed authentication error", async () => {
    const request: typeof fetch = async () => audioResponse(new Uint8Array(), 401);

    await expect(createDeepgramTtsProvider({ fetch: request }).synthesize(input))
      .rejects.toBeInstanceOf(TtsAuthError);
  });

  it("maps HTTP 429 to a typed rate-limit error", async () => {
    const request: typeof fetch = async () => audioResponse(new Uint8Array(), 429);

    await expect(createDeepgramTtsProvider({ fetch: request }).synthesize(input))
      .rejects.toBeInstanceOf(TtsRateLimitError);
  });

  it("maps other HTTP failures to a typed provider error", async () => {
    const request: typeof fetch = async () => audioResponse(new Uint8Array(), 500);

    await expect(createDeepgramTtsProvider({ fetch: request }).synthesize(input))
      .rejects.toBeInstanceOf(TtsProviderError);
  });

  it("maps an empty audio body to a typed empty-result error", async () => {
    const request: typeof fetch = async () => audioResponse(new Uint8Array(), 200);

    await expect(createDeepgramTtsProvider({ fetch: request }).synthesize(input))
      .rejects.toBeInstanceOf(TtsEmptyResultError);
  });

  it("maps a rejected request to a typed provider error", async () => {
    const request: typeof fetch = async () => {
      throw new Error("network unavailable");
    };

    await expect(createDeepgramTtsProvider({ fetch: request }).synthesize(input))
      .rejects.toBeInstanceOf(TtsProviderError);
  });

  it("rejects blank text before sending a request", async () => {
    let requestCount = 0;
    const request: typeof fetch = async () => {
      requestCount += 1;
      return audioResponse(sampleAudio);
    };

    await expect(createDeepgramTtsProvider({ fetch: request }).synthesize({ text: "" }))
      .rejects.toBeTruthy();
    expect(requestCount).toBe(0);
  });
});
