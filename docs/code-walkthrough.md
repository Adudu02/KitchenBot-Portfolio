# Code walkthrough

This guide is a reading path through the runnable source in this repository. Each example pairs implementation with executable checks so a reviewer can assess the code directly.

## Parsing and algorithm design

Read [`parseOrder`](../voice-eval/src/parse-order.js) and [`scoreOrder`](../voice-eval/src/score-order.js).

The parser resolves menu aliases and Spanish quantities into structured items. It keeps ambiguous input as diagnostic metadata instead of silently choosing a specific item. The scorer pairs expected and recognized items, compares item, quantity and modifiers, and reports deletions, substitutions and insertions separately. Its exhaustive matching is deliberately limited to small evaluation orders; it is disposable evaluation tooling.

The [parser tests](../voice-eval/test/parse-order.test.js) cover overlapping aliases, modifier attachment and ambiguous item names. The [scorer tests](../voice-eval/test/score-order.test.js) distinguish a missing item from a wrong item and cover numeric variants, alias variants, insertions and empty transcripts.

From the repository root:

```sh
npm run demo -w voice-eval
npm test -w voice-eval
```

The demo runs the actual parser and scorer on seven hand-written cases without a provider call. The full voice test suite also requires FFmpeg. These examples demonstrate the evaluation code; the private ordering agent's conversational implementation is not included.

## Typed contracts and external-service boundaries

Start with the [speech-to-text contract](../packages/stt/src/contract.ts), then read the [Deepgram adapter](../packages/stt/src/deepgram.ts) and its [tests](../packages/stt/src/deepgram.test.ts). Input validation, request construction, provider-response validation and typed errors are visible in one small package. Injecting `fetch` lets the tests exercise successful and failed responses without network access.

The tests check unsupported formats, malformed JSON, empty provider results, rejected requests and vocabulary limits before a request is sent. The [text-to-speech adapter](../packages/tts/src/deepgram.ts) and its [tests](../packages/tts/src/deepgram.test.ts) show the corresponding audio-output boundary, including authentication errors, rate limits and empty audio.

```sh
npm test -w @kitchenbot/stt -w @kitchenbot/tts
npm run typecheck -w @kitchenbot/stt -w @kitchenbot/tts
```

These commands use fake provider responses; they do not establish live-provider availability or speech-recognition quality. The measured evaluation outcome is recorded in [ADR 0003](adr/0003-voice-channel-go-no-go.md).

## Android implementation with testable hardware logic

Read [ReceiptFormatter.kt](../printer-android/app/src/main/java/com/eduardoarce/kitchenbot/printer/printer/ReceiptFormatter.kt) alongside [ReceiptFormatterTest.kt](../printer-android/app/src/test/java/com/eduardoarce/kitchenbot/printer/printer/ReceiptFormatterTest.kt). The formatter produces printer markup and a text preview without Android or Bluetooth I/O. Tests check layout widths, alignment, blank headers, font styles and reversible uppercase formatting.

Next read [PrinterStatus.kt](../printer-android/app/src/main/java/com/eduardoarce/kitchenbot/printer/printer/PrinterStatus.kt) and [PrinterStatusTest.kt](../printer-android/app/src/test/java/com/eduardoarce/kitchenbot/printer/printer/PrinterStatusTest.kt). The decoder interprets ESC/POS status bits and represents missing or invalid replies as unknown. The tests verify decoding; they do not prove that a particular printer answers the commands.

The [ticket editor](../printer-android/app/src/main/java/com/eduardoarce/kitchenbot/printer/ui/ReceiptScreen.kt), [Bluetooth repository](../printer-android/app/src/main/java/com/eduardoarce/kitchenbot/printer/printer/BluetoothRepository.kt) and [queue service](../printer-android/app/src/main/java/com/eduardoarce/kitchenbot/printer/queue/PrintQueueService.kt) show how that logic fits into the app. Their device and lifecycle behavior still needs manual validation.

```sh
cd printer-android
./gradlew test assembleDebug
```

See the [Android README](../printer-android/README.md) for the JDK/SDK requirements and the real phone/printer checklist.

## A runnable integration without the private backend

The [mock HTTP server](../mock-kitchen-api/src/server.js) provides the printer-facing contract using fictitious, in-memory orders. Its [tests](../mock-kitchen-api/test/server.test.js) exercise token checks, kitchen-ID checks, queue acknowledgements, stale print keys and malformed JSON through real HTTP requests.

```sh
npm test -w mock-kitchen-api
npm start -w mock-kitchen-api
```

This server was added for the public showcase. It is a demo fixture, not a sample of the production backend or evidence that I wrote the entire backend. The [pairing instructions](../printer-android/README.md#try-it-without-a-real-backend) explain how to connect the real Android app to it.

## Individual and team contributions

The contribution statements below follow the owner-confirmed [My role](../README.md#my-role) section. They distinguish personal contributions from shared product work.

| Area | Contribution represented here |
| --- | --- |
| Voice evaluation | Eduardo designed and ran the evaluation, including the degradation pipeline, parser, scorer, provider adapters and annotation guide. The corpus run is included in that claim; recording or annotating every sample is not claimed. |
| Speech packages | Eduardo built the STT/TTS packages and integrated voice-note support in the private system. The published packages show the contracts and adapters; team contributions are not presented as exclusively his work. |
| Android printer | Shared app. Eduardo's contributions include receipt formatting, ticket templates and editor, printer configuration, header sync and physical-status readback. The whole Android app is not claimed as individual work. |
| Decisions | Eduardo wrote the three ADRs and the research behind the transport and voice decisions. Those records connect implementation constraints with the resulting decisions. |

The public Git history begins with a curated export and records preparation of this showcase. It does not reproduce the team's original development history. The source and tests support technical review; the contribution statements describe ownership.

## What a reviewer can verify

With Node.js 22 or newer and FFmpeg installed, run `npm ci && npm test` at the root. Android tests run separately with the documented JDK and SDK. [CI](../.github/workflows/ci.yml) runs the Node tests, Android tests and generic sanitization check.

The published material supports review of parsing, algorithms, TypeScript contracts, failure handling, Kotlin, UI code, hardware boundaries, tests and technical decisions. Agent prompts, conversation policies, private routing/tool definitions, real recordings, customer data and deployment credentials stay outside this repository.
