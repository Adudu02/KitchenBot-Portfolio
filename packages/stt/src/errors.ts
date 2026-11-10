export type SttErrorCode =
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "UNSUPPORTED_FORMAT"
  | "PROVIDER_ERROR"
  | "EMPTY_RESULT"
  | "VOCABULARY_LIMIT";

export class SttError extends Error {
  constructor(
    public readonly code: SttErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
  }
}

export class SttAuthError extends SttError {
  constructor(provider: string, cause?: unknown) {
    super("AUTH_FAILURE", `${provider} authentication failed`, cause);
  }
}

export class SttRateLimitError extends SttError {
  constructor(provider: string, cause?: unknown) {
    super("RATE_LIMIT", `${provider} rate limit exceeded`, cause);
  }
}

export class SttUnsupportedFormatError extends SttError {
  constructor(mimeType: string) {
    super("UNSUPPORTED_FORMAT", `Unsupported audio MIME type: ${mimeType}`);
  }
}

export class SttProviderError extends SttError {
  constructor(
    provider: string,
    public readonly status?: number,
    cause?: unknown,
  ) {
    super(
      "PROVIDER_ERROR",
      status === undefined
        ? `${provider} returned an invalid response`
        : `${provider} request failed with HTTP ${status}`,
      cause,
    );
  }
}

export class SttEmptyResultError extends SttError {
  constructor(provider: string) {
    super("EMPTY_RESULT", `${provider} returned no transcription result`);
  }
}

export class SttVocabularyLimitError extends SttError {
  constructor(
    public readonly tokenCount: number,
    public readonly limit: number,
  ) {
    super(
      "VOCABULARY_LIMIT",
      `Vocabulary hints exceed the ${limit}-token limit (${tokenCount} supplied)`,
    );
  }
}
