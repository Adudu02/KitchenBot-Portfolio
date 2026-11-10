# voice-eval

A small, disposable harness for answering one question before any product code
is written: **can affordable speech recognition handle food orders spoken in
Mexican Spanish over telephone-grade audio?**

It degrades one source recording into realistic channel conditions, sends it to
speech-to-text providers, parses each transcript into a structured order, and
scores that order against a hand-annotated reference. The outcome of the real
run is recorded in [ADR 0003](../docs/adr/0003-voice-channel-go-no-go.md): the
decision was to **defer** the voice channel.

You can see the scorer work without any API key, audio or corpus:

```bash
npm install
npm run demo -w voice-eval
```

## The problem

Customers send food orders by WhatsApp. Letting them order by voice is
attractive, but the audio is hard: Mexican Spanish, kitchen and street noise,
and compression by the channel. The conservative test condition is **8 kHz
telephony audio** (condition C), treated as the floor. A model that works there
should also work on WhatsApp voice notes (condition A) and on microphone input;
the reverse is not true. Conditions are generated from a single source file and
read from a manifest rather than from a directory listing, so scratch files can
never be mistaken for test conditions.

## Why structured orders, not word error rate

Word error rate (WER) weights every word equally. A mistake on "por favor" and
a mistake on "horchata" cost the same, although one is invisible and the other
means a remade dish. An order is also only about a dozen words and is correct
only if every field is correct, so word-level numbers that sound excellent
produce order-level results that are not.

Each transcript is therefore parsed into `{ item, quantity, modifiers }` and
compared field by field with the reference order. Numeric and lexical variants
of the same value are matches ("tres" equals 3, "tacos de pastor" equals
"taco al pastor"), and the accepted equivalences are enumerated in
[`aliases.json`](aliases.json) so the scorer cannot invent its own. The
reasoning is in [ADR 0002](../docs/adr/0002-voice-poc-evaluation-criteria.md).

## Why deletions and substitutions are separate metrics

The ordering agent reads the order back to the customer before closing. That
read-back catches a wrong item (the customer hears "agua de jamaica" and
corrects it) but not a missing one: nobody notices an item that was never
mentioned. They confirm, hang up, and the drink never arrives.

The two errors therefore carry different business costs, and averaging them
would hide exactly the failure the confirmation step cannot catch. The scorer
reports them separately, together with insertions (unrequested items).

## Thresholds

Measured on the telephony condition (the floor). These are exploratory
thresholds for technology evaluation, not a production standard.

| Criterion | Threshold |
| --- | --- |
| Gate | at least 65% of orders with every field correct |
| Guardrail | at most 5% of orders missing an entire item |
| Discriminator | among providers passing both: highest field-level accuracy, deletion rate as tiebreaker |

## The two verification gates

Two checkpoints had to pass before the numbers could be trusted:

1. **Audio conditions.** The telephony condition was verified to be genuinely
   narrowband by measurement, not by assertion. Evidence:
   [`GATE-VERIFICATION.md`](GATE-VERIFICATION.md).
2. **Scorer correctness.** The scorer was verified against hand-written fake
   transcripts before any paid provider call. A deletion-detection bug would
   look entirely normal in the results table, so it has to be checked where it
   can be seen. `npm run demo` and `test/score-order.test.js` are exactly this
   check, covering exact match, numeric variant, alias variant, substitution,
   deletion, insertion and empty transcript.

## Results

Corpus: 21 annotated samples from 11 speakers, condition C (telephony).
"Baseline" is the provider default; "boosted" adds vocabulary hints built only
from the known menu (Deepgram Nova-3 `keyterm`, Google Cloud `speechContexts`).

| Provider | Metric | Baseline | Boosted |
| --- | --- | ---: | ---: |
| Deepgram | Orders fully correct (gate, at least 65%) | 4/21 = 19.05% | 9/21 = 42.86% |
| Deepgram | Orders missing an item (guardrail, at most 5%) | 16/21 = 76.19% | 9/21 = 42.86% |
| Deepgram | Field error rate (discriminator) | 9/114 = 7.89% | 12/150 = 8.00% |
| Google Cloud | Orders fully correct (gate, at least 65%) | 3/21 = 14.29% | 3/21 = 14.29% |
| Google Cloud | Orders missing an item (guardrail, at most 5%) | 17/21 = 80.95% | 17/21 = 80.95% |
| Google Cloud | Field error rate (discriminator) | 11/102 = 10.78% | 11/102 = 10.78% |

No tested provider or configuration passed either the gate or the guardrail.
Boosting helped Deepgram materially but left it roughly 8.5 times above the
guardrail; Google Cloud did not respond to the boosting configuration tested.
The dominant failure was systematic misrecognition of fixed menu vocabulary,
in particular the loanword "boneless".

**Decision: defer** the customer voice-ordering channel, rather than drop it,
because the failure is specific and addressable. A POC that shows a technology
is not ready is a successful POC. Full reasoning, including the evidence still
missing (boosting on condition A, and address and name recognition):
[ADR 0003](../docs/adr/0003-voice-channel-go-no-go.md).

## Running the keyless demo

```bash
npm run demo -w voice-eval
```

This scores seven hand-written fake transcripts from [`demo/cases.json`](demo/cases.json)
and prints a table with Deletions and Substitutions as separate columns. It
needs no network, credentials or audio. The tests run the same cases:
`npm test -w voice-eval`.

## Reproducing with your own corpus

The corpus used for the real run (21 samples, 11 speakers) is **not
published**: it consists of recordings of real people, and neither the audio nor
the transcripts are shared for privacy. To reproduce the study, record your own:

1. Copy [`sample.template.json`](sample.template.json) once per recording into
   `voice-eval/samples/`, and put the clean audio in `voice-eval/audio/`.
   [`ANNOTATION-GUIDE.md`](ANNOTATION-GUIDE.md) explains every field and how to
   annotate the reference order.
2. Adjust [`aliases.json`](aliases.json) and [`modifiers.json`](modifiers.json)
   to your menu.
3. Copy [`config.example.json`](config.example.json) to `config.json`, enable the
   providers you want, and set their credentials through the environment
   variables named there (`GOOGLE_APPLICATION_CREDENTIALS`, `DEEPGRAM_API_KEY`).
4. Validate and run:

```bash
npm run validate:corpus -w voice-eval
npm run run:poc -w voice-eval
```

At least 20 valid samples are required; with fewer, the whole set is rejected
before any API spend.

## Scope

Everything in this directory is throwaway evaluation tooling. It is not meant to
be imported by production code.
