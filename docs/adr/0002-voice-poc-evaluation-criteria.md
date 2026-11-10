# 2. Evaluation criteria for the speech recognition proof of concept

- **Status:** Accepted
- **Date:** 2026-07-28
- **Deciders:** Eduardo Arce
- **Related:** [ADR 0001](0001-whatsapp-transport-migration.md)
- **Amended:** 2026-07-29 — Amendment 1: the audio source is WhatsApp voice
  notes, not clean recordings. See [Amendment 1](#amendment-1--2026-07-29-audio-source-is-whatsapp-voice-notes-not-clean-recordings)
  at the end of this document.

---

## Context

Before building a voice ordering channel we need to know whether low-cost speech
recognition is accurate enough for Mexican Spanish over telephone-grade audio.
That question is the entire purpose of the POC, and it needs a pass mark agreed
in advance — a threshold decided after seeing results always gets rationalised.

Two facts shape what we should measure.

**Order accuracy degrades much faster than word accuracy.** An order is roughly
twelve words, and it is correct only if every field is correct. Word-level error
rates that sound excellent produce order-level results that are not: at 5% word
error, only about half of orders come through perfectly. Any threshold we set has
to be expressed at the level the business actually operates on.

**The read-back protects against one failure mode, not both.** The ordering
agent reads the order back to the customer before closing, which catches a wrong
item but not a missing one. A wrong item is visible in what is read back; a
deletion produces no signal to react to, because nothing was recorded that could
look wrong. Deletions and substitutions therefore carry different business cost
and must not be averaged together.

## Decision

**Evaluate at the structured-order level, not raw transcript accuracy, against
three separate criteria.**

Each transcript is parsed into `{item, quantity, modifiers}` and compared field by
field against a reference order. Numeric and lexical variants of the same value
count as matches — `"tres"` equals `3`, `"taco de pastor"` equals
`"tacos al pastor"`. Accepted equivalences are enumerated in [`voice-eval/aliases.json`](../../voice-eval/aliases.json)
so the scorer cannot invent its own.

### The three criteria

| | Criterion | Threshold | Condition |
| --- | --- | --- | --- |
| **Gate** | Orders with every field correct | ≥ 65% | 8 kHz telephony-degraded |
| **Guardrail** | Orders missing an entire item | ≤ 5% | 8 kHz telephony-degraded |
| **Discriminator** | Field-level accuracy among providers passing both | highest wins | 8 kHz telephony-degraded |

Deletion rate is the tiebreaker on the discriminator.

**Why the guardrail is separate from the gate.** A provider that substitutes
often but never drops items is better for us than one with a better average that
silently loses a drink. Merging these into one number hides exactly the failure
the read-back cannot catch.

**Why everything is measured at 8 kHz.** Narrowband telephony is our floor. A
model that performs there also performs on WhatsApp voice notes and on
microphone input. The reverse does not hold — and a POC validated only on clean
microphone audio is the standard way a voice project looks excellent in demo and
falls over in production.

## Alternatives Considered

### Word Error Rate — **rejected**

The conventional metric, with broad benchmark data available for comparison.
Rejected because it weights every word equally: an error on `"por favor"` counts
the same as an error on `"horchata"`. One is invisible, the other means remade
food and an unhappy customer. WER does not track business impact, and no
threshold expressed in WER is something a non-specialist can meaningfully
approve.

### Literal transcript accuracy — **rejected**

Scoring the full transcript string against a reference. Rejected as roughly twice
as strict for no business benefit — it penalises `"tres"` versus `3` and plural
variants that have zero effect on what the kitchen produces. Under this
definition the same 65% target would likely fail every affordable model on 8 kHz
audio, producing the wrong conclusion from the right experiment.

### A single combined accuracy metric — **rejected**

Simpler to report and to compare. Rejected because it would let a provider with a
strong average conceal a high deletion rate, which is the specific failure the
read-back does not catch.

## Consequences

### The 65% threshold is exploratory

> The 65% threshold is exploratory, set for technology evaluation only. It is NOT a production standard. Before exposing the voice channel to real customers, it must be revisited against observed re-order rates.

This clause is deliberate and load-bearing. Without it, an exploratory number
becomes the permanent standard by default, and in six months someone will defend
shipping at 65% on the grounds that we met the criterion.

### Reference data now requires two annotations per sample

Every sample carries both a literal transcript and a structured
`order_expected`. Annotating the structured order while recording takes seconds;
reconstructing it afterwards from audio takes an order of magnitude longer. This
is the bottleneck on starting the POC and it cannot be delegated to tooling.

### Scoring correctness must be verified before spending on transcription

The scorer is validated against hand-written fake transcripts before any provider
API is called. A bug in deletion detection invalidates the guardrail entirely and
would not be visible in the summary table.

### POC success and go/no-go are separate outcomes

The POC succeeds when the harness runs end to end and produces the three metrics
across all three audio conditions. **Whether any provider clears the thresholds is
the finding, not the acceptance criterion.** A POC demonstrating that affordable
speech recognition cannot handle our audio is a successful POC — it saves us
building on a foundation that does not hold.

### Deferred to a later phase

Conversational friction — how many corrections a customer tolerates before
abandoning the order — is the metric that will matter once there is a live
voice channel. It is out of scope here and is recorded so its absence is
deliberate rather than overlooked.

---

## Amendment 1 — 2026-07-29: audio source is WhatsApp voice notes, not clean recordings

**Status:** Accepted amendment. This does **not** supersede the ADR. The
structured-order scoring method, the three separate metrics, and the gate and
guardrail thresholds are unchanged. The amendment narrows one input assumption —
the origin of the source audio — and the condition set that follows from it.

### What changed

The original decision assumed a **clean source recording**, from which three
conditions (clean, WhatsApp voice note, telephony) are derived by degradation.
In practice the corpus is real **WhatsApp voice notes** (Opus, mono, ~16 kHz) —
already lossy-compressed at capture. There is no clean source, and re-recording
one is out of scope for this POC.

### Consequence for the condition set

With a WhatsApp source, the original A/B/C ladder collapses and is replaced:

- **A "clean-source"** no longer exists. A byte-for-byte copy of a WhatsApp file
  is not clean; labelling it "clean" would misrepresent the measurement.
- **B "WhatsApp re-encode"** becomes redundant (Opus → Opus) and is dropped.
- **C "telephony 8 kHz"** is **retained**, derived by downsampling the WhatsApp
  audio to 8 kHz mu-law.

The POC therefore evaluates **two** conditions: *as-received WhatsApp* and
*telephony-8 kHz derived from it*. The gate (≥ 65% complete orders) and the
guardrail (≤ 5% item deletions) continue to be measured on the 8 kHz telephony
condition, which remains the conservative floor.

### What this costs

The POC can no longer make any claim about clean-microphone performance — that
baseline never existed in this corpus. The body's "performs at telephony ⇒ also
performs on WhatsApp voice notes and microphone input" argument now holds only
from telephony up to the WhatsApp voice note; microphone input is untested. This
is acceptable because the near-term integration is the WhatsApp voice-note path —
live calling is blocked on the transport migration and phased Calling API access
(ADR 0001) — so the voice note is the realistic production input, not clean
microphone audio.

### Annotation reinforcement

Because the source audio is already degraded, `order_expected` and
`transcript_literal` must be annotated from **what the customer actually
ordered** (the recording script, or the order ticket), never transcribed from
the WhatsApp audio itself. Annotating from the degraded audio would reproduce the
same errors the STT makes and defeat the evaluation.

### Follow-up (code, downstream of this amendment)

`voice-eval/src/audio-conditions.js`, the `conditions.json` manifest, and
`voice-eval/README.md` must be updated to the two-condition set before the corpus run.
That change is a consequence of this recorded decision, not a silent departure
from it. Gate 1 (narrowband verification) should be re-confirmed on a
telephony condition derived from a WhatsApp sample, since the existing evidence
was produced from a clean source.
