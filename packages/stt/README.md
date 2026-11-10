# `@kitchenbot/stt`

Thin speech-to-text for audio supplied as a `Buffer` or file path. In the
original system it was used to transcribe incoming WhatsApp voice notes.

It validates input, sends audio to a provider, and returns transcript text plus
provider metadata. It does not fetch voice notes, parse orders, manage menus,
handle addresses, persist audio or transcripts, or know about any transport or
UI.

## Contract and adapter

The package is split in two layers:

- **Contract** (`src/contract.ts`): the `SpeechToTextProvider` interface, the
  zod-validated `TranscriptionInput`, and the `TranscriptionResult` shape.
  Consumers depend only on this.
- **Adapter** (`src/deepgram.ts`): one implementation of the contract.
  `createDeepgramProvider()` currently uses Deepgram `nova-3`.

Keeping the contract separate from the adapter means the provider can be
swapped (or several compared, as in `voice-eval/`) by writing a new adapter,
without touching any consumer.

```ts
interface TranscriptionInput {
  audio: Buffer | string; // bytes, or a path to an audio file
  mimeType: string;
  language: string;
  vocabularyHints?: string[];
}

interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
  raw: unknown;
}

interface SpeechToTextProvider {
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
```

Supported MIME types are `audio/ogg` and `audio/wav`. Empty or no-speech
results return `text: ""`.

The package exposes typed errors for authentication, rate limiting,
unsupported formats, provider failures, empty results, and the Deepgram
500-token vocabulary limit. Over-limit vocabulary is rejected before a request
is sent and is never silently truncated.

## Usage

```ts
import { createDeepgramProvider } from "@kitchenbot/stt";

const result = await createDeepgramProvider().transcribe({
  audio: voiceNoteBuffer,
  mimeType: "audio/ogg",
  language: "es-419",
  vocabularyHints: ["term one", "term two"], // optional
});
```

The caller owns the vocabulary. Never add a domain term list to this package;
different consumers have different vocabularies.

## Environment

Names only; see `.env.example`. Never commit values.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DEEPGRAM_API_KEY` | Deepgram adapter | Required. Read from `process.env` at call time. |
| `DEEPGRAM_API_URL` | Deepgram adapter | Optional endpoint override. Read at call time. |
| `STT_SMOKE` | `src/smoke.ts` | Must be `1` to authorize the paid smoke request. |
| `STT_SMOKE_AUDIO_PATH` | `src/smoke.ts` | Audio file to transcribe in the smoke run. |

## Tests

```bash
npm test -w @kitchenbot/stt
npm run typecheck -w @kitchenbot/stt
```

The unit tests inject a fake `fetch` and set a dummy key themselves. They need
no real API key and make no network calls.

## Smoke test (paid, manual)

One real request against the provider. It reads the key only from the
environment, and requires you to opt in:

```bash
DEEPGRAM_API_KEY=... STT_SMOKE=1 STT_SMOKE_AUDIO_PATH=/absolute/path/to/audio.ogg \
  npm run smoke -w @kitchenbot/stt
```

The audio file is yours to supply; this repository ships no audio.
