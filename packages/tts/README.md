# `@kitchenbot/tts`

Thin text-to-speech: text in, audio bytes out. In the original system it was
used to synthesize voice-note replies for WhatsApp.

It validates input, calls a provider, and returns the audio buffer with its
MIME type and provider metadata. It does not decide what to say, send
messages, or persist audio.

## Contract and adapter

- **Contract** (`src/contract.ts`): the `TextToSpeechProvider` interface, the
  zod-validated `SynthesisInput`, and the `SynthesisResult` shape. Consumers
  depend only on this.
- **Adapter** (`src/deepgram.ts`): one implementation of the contract.
  `createDeepgramTtsProvider()` uses Deepgram Aura voices.

Keeping the contract separate from the adapter means the provider can be
swapped by writing a new adapter, without touching any consumer.

```ts
interface SynthesisInput {
  text: string;
  language?: string;        // e.g. "es", "en"; picks a default voice (default "es")
  voice?: string;           // explicit provider voice id; overrides `language`
  format?: "mp3" | "ogg_opus"; // default "mp3"; "ogg_opus" suits WhatsApp voice notes
}

interface SynthesisResult {
  audio: Buffer;
  mimeType: string;
  provider: string;
  model: string;
  raw: unknown;
}

interface TextToSpeechProvider {
  synthesize(input: SynthesisInput): Promise<SynthesisResult>;
}
```

Typed errors cover authentication, rate limiting, provider failures, and empty
results.

## Usage

```ts
import { createDeepgramTtsProvider } from "@kitchenbot/tts";

const { audio, mimeType } = await createDeepgramTtsProvider().synthesize({
  text: "Hola, tu pedido está listo.",
  format: "ogg_opus",
});
```

## Environment

Names only; see `.env.example`. Never commit values.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DEEPGRAM_API_KEY` | Deepgram adapter | Required. Read from `process.env` at call time. |
| `DEEPGRAM_TTS_URL` | Deepgram adapter | Optional endpoint override. Read at call time. |
| `TTS_SMOKE` | `src/smoke.ts` | Must be `1` to authorize the paid smoke request. |
| `TTS_SMOKE_TEXT` | `src/smoke.ts` | Optional text to synthesize (a Spanish default is built in). |
| `TTS_SMOKE_OUTPUT_PATH` | `src/smoke.ts` | Optional output file (default `tts-smoke.mp3`, git-ignored). |

## Tests

```bash
npm test -w @kitchenbot/tts
npm run typecheck -w @kitchenbot/tts
```

The unit tests inject a fake `fetch` and set a dummy key themselves. They need
no real API key and make no network calls.

## Smoke test (paid, manual)

One real request against the provider. It reads the key only from the
environment, and requires you to opt in:

```bash
DEEPGRAM_API_KEY=... TTS_SMOKE=1 npm run smoke -w @kitchenbot/tts
```
