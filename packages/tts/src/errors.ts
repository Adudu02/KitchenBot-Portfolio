export type TtsErrorCode =
  | "AUTH_FAILURE"
  | "RATE_LIMIT"
  | "PROVIDER_ERROR"
  | "EMPTY_RESULT";

export class TtsError extends Error {
  constructor(
    public readonly code: TtsErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = new.target.name;
  }
}

export class TtsAuthError extends TtsError {
  constructor(provider: string, cause?: unknown) {
    super("AUTH_FAILURE", `${provider} authentication failed`, cause);
  }
}

export class TtsRateLimitError extends TtsError {
  constructor(provider: string, cause?: unknown) {
    super("RATE_LIMIT", `${provider} rate limit exceeded`, cause);
  }
}

export class TtsProviderError extends TtsError {
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

export class TtsEmptyResultError extends TtsError {
  constructor(provider: string) {
    super("EMPTY_RESULT", `${provider} returned no audio`);
  }
}
