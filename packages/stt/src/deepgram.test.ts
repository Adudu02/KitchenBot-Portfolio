import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createDeepgramProvider,
  SttAuthError,
  SttEmptyResultError,
  SttProviderError,
  SttUnsupportedFormatError,
  SttVocabularyLimitError,
  type TranscriptionInput,
} from "./index.js";

const input: TranscriptionInput = {
  audio: Buffer.from("audio"),
  mimeType: "audio/ogg",
  language: "es-419",
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulResponse(transcript: string): Response {
  return response({
    results: {
      channels: [{ alternatives: [{ transcript }] }],
    },
  });
}

describe("Deepgram provider", () => {
  const previousApiKey = process.env.DEEPGRAM_API_KEY;
  const previousApiUrl = process.env.DEEPGRAM_API_URL;

  beforeEach(() => {
    process.env.DEEPGRAM_API_KEY = "test-key";
    delete process.env.DEEPGRAM_API_URL;
  });

  afterEach(() => {
    if (previousApiKey === undefined) {
      delete process.env.DEEPGRAM_API_KEY;
    } else {
      process.env.DEEPGRAM_API_KEY = previousApiKey;
    }
    if (previousApiUrl === undefined) {
      delete process.env.DEEPGRAM_API_URL;
    } else {
      process.env.DEEPGRAM_API_URL = previousApiUrl;
    }
  });

  it("returns transcript text and provider metadata", async () => {
    const request: typeof fetch = async (_url, init) => {
      expect(new Headers(init?.headers).get("Content-Type")).toBe("audio/ogg");
      return successfulResponse("Quiero dos tacos");
    };

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .resolves.toMatchObject({
        text: "Quiero dos tacos",
        provider: "deepgram",
        model: "nova-3",
      });
  });

  it("returns an empty string for no speech", async () => {
    const request: typeof fetch = async () => successfulResponse("");

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .resolves.toMatchObject({ text: "" });
  });

  it("maps HTTP 401 to a typed authentication error", async () => {
    const request: typeof fetch = async () => response({}, 401);

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .rejects.toBeInstanceOf(SttAuthError);
  });

  it("rejects vocabulary over the 400-word safety threshold before sending a request", async () => {
    let requestCount = 0;
    const request: typeof fetch = async () => {
      requestCount += 1;
      return successfulResponse("unreachable");
    };
    const vocabularyHints = Array.from({ length: 401 }, () => "term");

    await expect(createDeepgramProvider({ fetch: request }).transcribe({
      ...input,
      vocabularyHints,
    })).rejects.toBeInstanceOf(SttVocabularyLimitError);
    expect(requestCount).toBe(0);
  });

  it("allows vocabulary at the 400-word safety threshold", async () => {
    const request: typeof fetch = async () => successfulResponse("at limit");
    const vocabularyHints = Array.from({ length: 400 }, () => "term");

    await expect(createDeepgramProvider({ fetch: request }).transcribe({
      ...input,
      vocabularyHints,
    })).resolves.toMatchObject({ text: "at limit" });
  });

  it("rejects vocabulary over the UTF-8 byte safety limit independently", async () => {
    let requestCount = 0;
    const request: typeof fetch = async () => {
      requestCount += 1;
      return successfulResponse("unreachable");
    };

    await expect(createDeepgramProvider({ fetch: request }).transcribe({
      ...input,
      vocabularyHints: ["á".repeat(2_001)],
    })).rejects.toMatchObject({
      code: "VOCABULARY_LIMIT",
      message: expect.stringContaining("4000-byte safety limit"),
    });
    expect(requestCount).toBe(0);
  });

  it("omits keyterm parameters when vocabulary hints are omitted", async () => {
    let requestedUrl = "";
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return successfulResponse("baseline");
    };

    await createDeepgramProvider({ fetch: request }).transcribe(input);

    expect(new URL(requestedUrl).searchParams.has("keyterm")).toBe(false);
  });

  it("uses the production Deepgram URL when the override is unset", async () => {
    let requestedUrl = "";
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return successfulResponse("baseline");
    };

    await createDeepgramProvider({ fetch: request }).transcribe(input);

    expect(new URL(requestedUrl).origin + new URL(requestedUrl).pathname)
      .toBe("https://api.deepgram.com/v1/listen");
  });

  it("sends every vocabulary hint as its own keyterm parameter", async () => {
    let requestedUrl = "";
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return successfulResponse("boosted");
    };

    await createDeepgramProvider({ fetch: request }).transcribe({
      ...input,
      vocabularyHints: ["Tacos Don Pepe", "jamaica"],
    });

    expect(new URL(requestedUrl).searchParams.getAll("keyterm")).toEqual([
      "Tacos Don Pepe",
      "jamaica",
    ]);
  });

  it("URL-encodes accented and reserved characters in vocabulary hints", async () => {
    let requestedUrl = "";
    const request: typeof fetch = async (url) => {
      requestedUrl = url.toString();
      return successfulResponse("boosted");
    };
    const vocabularyHints = ["jalapeño & limón", "más + salsa?", "ají/árbol"];

    await createDeepgramProvider({ fetch: request }).transcribe({
      ...input,
      vocabularyHints,
    });

    expect(new URL(requestedUrl).searchParams.getAll("keyterm"))
      .toEqual(vocabularyHints);
  });

  it("rejects unsupported MIME types", async () => {
    let requestCount = 0;
    const request: typeof fetch = async () => {
      requestCount += 1;
      return successfulResponse("unreachable");
    };

    await expect(createDeepgramProvider({ fetch: request }).transcribe({
      ...input,
      mimeType: "text/plain",
    })).rejects.toBeInstanceOf(SttUnsupportedFormatError);
    expect(requestCount).toBe(0);
  });

  it("maps a malformed provider response to a typed provider error", async () => {
    const request: typeof fetch = async () => response({ results: {} });

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .rejects.toBeInstanceOf(SttProviderError);
  });

  it("maps a valid provider response without alternatives to an empty result", async () => {
    const request: typeof fetch = async () => response({
      results: { channels: [{ alternatives: [] }] },
    });

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .rejects.toBeInstanceOf(SttEmptyResultError);
  });

  it("maps a valid provider response without channels to an empty result", async () => {
    const request: typeof fetch = async () => response({
      results: { channels: [] },
    });

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .rejects.toBeInstanceOf(SttEmptyResultError);
  });

  it("maps a rejected request to a typed provider error", async () => {
    const request: typeof fetch = async () => {
      throw new Error("network unavailable");
    };

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .rejects.toBeInstanceOf(SttProviderError);
  });

  it("maps invalid provider JSON to a typed provider error", async () => {
    const request: typeof fetch = async () => new Response("not JSON");

    await expect(createDeepgramProvider({ fetch: request }).transcribe(input))
      .rejects.toBeInstanceOf(SttProviderError);
  });
});
