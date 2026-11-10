# 3. Voice channel go/no-go after the speech-to-text POC

- **Status:** Accepted — **Defer** the customer voice-ordering channel
- **Date:** 2026-07-31 (decided 2026-08-01)
- **Deciders:** Eduardo Arce
- **Related:** [ADR 0002](0002-voice-poc-evaluation-criteria.md)
- **Evidence:** baseline run (2026-07-31 21:41 UTC) and boosted run (2026-07-31 22:32 UTC); raw result files are available in the private repository

---

## Context

ADR 0002 defined the proof-of-concept criteria for Mexican Spanish food-order
speech recognition under condition C, the telephony-degraded floor:

- **Gate:** at least 65% of orders have every structured field correct.
- **Guardrail:** at most 5% of orders are missing an entire item.
- **Discriminator:** field error rate only compares providers that pass both.

The completed corpus contains 21 annotated samples from 11 speakers. The audio
conditions come from each sample manifest, and the deterministic parser and
scorer were verified before these results were treated as evidence. Item
deletion rate and field error rate remain separate because they represent
different operational risks.

The baseline exposed systematic recognition failures on fixed menu vocabulary,
especially the loanword `boneless` and the phrase `aros de cebolla`. A single
mitigation was then tested: provider-supported vocabulary boosting using only
the known menu. No failed transcript spelling was added to either vocabulary.

Deepgram received 31 distinct canonical menu items and modifier terms through
Nova-3 `keyterm` parameters. Its shorter list respected Deepgram’s aggregate
keyterm limit. Google received the already accepted 96 menu-derived canonical
and alias phrases through `speechContexts` with boost 20. This provider
asymmetry reflects their different API constraints, not transcript-specific
tuning.

## Evidence

All metrics below are for condition C. Deltas are boosted minus baseline.

| Provider | Metric | Baseline | Boosted | Delta | Threshold result |
| --- | --- | ---: | ---: | ---: | --- |
| Deepgram | `order_accuracy` | 4/21 = 19.05% | 9/21 = 42.86% | +23.81 pp | Fails gate |
| Deepgram | `item_deletion_rate` | 16/21 = 76.19% | 9/21 = 42.86% | -33.33 pp | Fails guardrail |
| Deepgram | `field_error_rate` | 9/114 = 7.89% | 12/150 = 8.00% | +0.11 pp | Discriminator only |
| Google Cloud | `order_accuracy` | 3/21 = 14.29% | 3/21 = 14.29% | 0.00 pp | Fails gate |
| Google Cloud | `item_deletion_rate` | 17/21 = 80.95% | 17/21 = 80.95% | 0.00 pp | Fails guardrail |
| Google Cloud | `field_error_rate` | 11/102 = 10.78% | 11/102 = 10.78% | 0.00 pp | Discriminator only |

The boosted run completed all 42 provider/sample calls with zero errors. The
baseline file was read directly and was not overwritten.

### Vocabulary-specific recovery

Recovery is counted per provider/sample transcript where the expected order
contains the term, the baseline lacks its exact canonical spelling, and the
boosted transcript gains that spelling.

| Provider | Term | Baseline losses | Recovered |
| --- | --- | ---: | ---: |
| Deepgram | `boneless` | 9 | 7 |
| Deepgram | `aros de cebolla` | 5 | 1 |
| Google Cloud | `boneless` | 11 | 0 |
| Google Cloud | `aros de cebolla` | 2 | 0 |

Deepgram’s keyterm configuration materially improved complete-order accuracy,
item deletion rate, and recognition of `boneless`. It did not bring either
threshold into passing range, and `aros de cebolla` remained mostly
unrecovered.

Google’s boosted condition-C transcripts were byte-for-byte identical to its
21 baseline transcripts. The tested `speechContexts` configuration therefore
produced no measured response in this corpus.

**No tested provider/configuration passes both the gate and guardrail.** This
is the experimental finding; it is not the architecture decision.

## Decision

**Defer the customer voice-ordering channel.** Signed off by Eduardo Arce on
2026-08-01.

No tested provider or configuration met the gate (≥65% fully correct orders) or
the guardrail (≤5% orders missing an entire item) on condition C. Deepgram with
`keyterm` vocabulary boosting improved materially — order accuracy 19.05% →
42.86%, item deletion 76.19% → 42.86% — but remains roughly 8.5× above the
guardrail. Google Cloud did not respond to the boosting configuration tested.

Deferring rather than dropping: the failure mode is specific and addressable —
systematic misrecognition of fixed menu vocabulary, dominated by the loanword
`boneless`. That is a narrower problem than general speech quality, so a
materially different approach could plausibly clear the bar later. This ADR
should be revisited, not treated as a permanent closure.

### What this decision does NOT block

This decision governs the **customer voice-ordering channel only**. It does not
affect, and explicitly permits, an internal operator use case (voice note →
transcript) implemented on 2026-08-01. That use case is materially lower risk: errors
are recoverable by the operator retrying, no customer order or delivery address
depends on the transcript, and no money moves as a result of a misrecognition.

### Evidence still missing if this is revisited

- **Condition A was never measured with vocabulary boosting.** Every boosted
  number above is condition C, the telephony-degraded floor. The realistic
  product condition is A — the WhatsApp voice note as received. Baseline
  condition A already outperformed C (28.6% vs 19.05% order accuracy) without
  boosting, so the boosted condition-A figure is unknown and plausibly better.
  The frozen corpus and scorer remain available to measure it at low cost.
- **Address and name recognition was never measured at all.** `order_expected`
  covers menu items only. Addresses and personal names are open vocabulary and
  cannot be improved by keyterm boosting, and a misrecognized address is an
  unrecoverable delivery failure. Any future proceed decision needs this
  measured first.

## Options considered

### Proceed with a voice channel

Continue toward a constrained implementation despite the failed POC
thresholds, with explicit acceptance of high observed deletion risk and a
requirement for additional validation or safeguards before customer exposure.

**Trade-off:** preserves momentum and uses the material Deepgram improvement,
but proceeds without any tested configuration meeting the pre-agreed evidence
bar.

### Defer the voice channel

Stop implementation work and retain the POC evidence until a materially
different provider, model, menu-constrained recognition approach, or channel
condition can be evaluated.

**Trade-off:** avoids building on a configuration that failed both thresholds,
but postpones voice-ordering value and leaves future evaluation work.

### Drop the voice channel

Remove voice ordering from the roadmap under the current product assumptions
and keep text/WhatsApp ordering as the supported intake channel.

**Trade-off:** eliminates further voice investment and operational risk, but
forecloses the channel unless a later ADR reopens it with new evidence.

## Consequences

- **No customer-facing voice-ordering implementation is authorized.** Building
  one requires a new ADR superseding this decision, backed by new evidence.
- The internal operator voice-note transcription use case remains authorized and
  unaffected (see "What this decision does NOT block" above).
- The POC remains disposable and must not be imported by production code or
  included in production images. Production reuses the *knowledge* from it —
  provider, model, `keyterm` boosting, the vocabulary failure mode — never the
  scaffolding.
- The frozen 21-sample corpus and both results files are retained privately
  (not published here), and the verified scorer is published in
  [`voice-eval/`](../../voice-eval/), as the evidence base for any future reconsideration. They should not
  be deleted as part of POC cleanup.
- The baseline and boosted metrics remain separate evidence artifacts.
- Item deletion rate and field error rate must continue to be reported
  separately; merging them would hide the exact failure this decision rests on.
- Reopening this decision requires, at minimum, measuring condition A with
  boosting and measuring address/name recognition — both listed above as
  missing.
