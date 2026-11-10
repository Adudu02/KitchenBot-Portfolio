# 1. Migrate the WhatsApp transport to the official Cloud API

- **Status:** Proposed — pending sign-off
- **Date:** 2026-07-28
- **Deciders:** Eduardo Arce
- **Supersedes:** none
- **Supporting research:** cost analysis and vendor comparison (available in the private repository)

---

## Context

The ordering agent takes customer orders over WhatsApp. The channel currently runs on an
unofficial WhatsApp Web client — a reverse-engineered library that authenticates
as a linked device.

Three things forced this decision:

**1. The account is showing anti-abuse signals.** We are seeing recurring session
disconnects and a "possible fraud" warning at device-link time. These are
consistent with the platform identifying the client as non-official. Accounts do
not clear this state by waiting.

**2. The exposure is operational, not technical.** If the number is banned we
lose, on the same day: the phone number customers have saved, the conversation
history with those customers, and the order intake channel — with no
fallback in place.

**3. Live voice calling cannot be built on the current client.** The library can
detect and reject an incoming call. It cannot answer one or exchange audio. The
upstream feature request for bidirectional call audio has been open since 2023
and remains unimplemented. Voice ordering is on our roadmap.

There is also a compounding cost: every feature shipped on the current client is
written against an integration layer we intend to replace.

## Decision

**Migrate the WhatsApp transport to Meta's official Cloud API, connecting
directly rather than through a reseller.**

The migration replaces the transport layer only. Everything above the transport
is unchanged.

### Transport flag has an expiry date

A configuration flag will allow switching between the current client and the
Cloud API. This flag exists **as a rollback mechanism during the migration
window, not as permanent architecture.**

> The transport flag and the unofficial client are both removed once the Cloud
> API has run 30 consecutive days in production without regression.

This clause is load-bearing. Without a forcing function, a dual-transport setup
becomes the excuse never to complete the migration — the old client stays as
default "because it works" and the exposure never closes.

## Alternatives considered

### Stay on the unofficial client — **rejected**

Zero migration cost, and it works today. Rejected because the warning signals
indicate the account is already flagged, there is no contractual recourse when
enforcement happens, and voice calling stays permanently out of reach. This is
not a stable state we are choosing to remain in; it is a deadline we do not
control.

### Route messaging through a Business Solution Provider — **rejected**

A reseller would front the API and absorb some integration work. Rejected on
cost: our traffic is customer-initiated, so replies land inside the free 24-hour
service window and cost nothing going direct to Meta. Resellers add a
per-message fee on top of the platform's own charges, applied to exactly that
traffic. It converts a near-zero messaging bill into a recurring per-message cost, in
exchange for webhook handling we already build and operate.

### Unofficial VoIP wrappers to unlock calling — **rejected**

Projects exist that hook the WhatsApp Web VoIP stack to get audio through. They
are not published to package registries, must be pulled from git, and are
oriented toward placing calls rather than answering them. Beyond maturity, voice
traffic is substantially more detectable than messaging, and layering it onto an
already-flagged account raises the odds of losing the number.

### Permanent dual-transport abstraction — **rejected**

Keeping both clients switchable indefinitely. Rejected because the two are not
two implementations of one interface — they have different semantics. The
24-hour messaging window is a behavioural constraint that reaches into application
logic, not an API detail that hides behind an adapter. A permanent abstraction
leaves two bad options: a lowest-common-denominator that forgoes the official
platform's features, or a leaky abstraction with transport conditionals spread
through the codebase and double the testing surface, forever.

## Consequences

### Gains

- Sanctioned platform standing; enforcement risk removed
- Stable HTTP webhooks — no QR pairing, no linked-device session to keep alive
- Session credential directory on disk disappears, closing a standing security
  liability
- No platform subscription fee; customer-initiated replies inside the 24-hour
  window carry no message cost
- Becomes eligible for the official Calling API — necessary, though not
  sufficient, since access is still phased

### Costs

- The number can no longer be used in the consumer WhatsApp app. All access
  becomes programmatic.
- Business verification required: registered legal entity with documentation.
  Bureaucratic lead time, not engineering time, and it is on the critical path.
- Messages sent outside the 24-hour window require pre-approved templates, each
  billed per delivered message by country and category.
- No group messaging support on Cloud API.
- Transport-layer rewrite: webhook idempotency and duplicate handling (the
  persistent socket did not force this on us), message ID format change, media
  upload and retrieval move to Meta endpoints, auth moves to access tokens.

### Open questions blocking execution

| Question | Why it blocks |
| --- | --- |
| Is the number registered to a legal entity or an individual? | Verification requires a registered business. Resolving a personal registration is paperwork on the critical path. |
| Can we port this exact number, or do we need a new one? | Customers have it saved. A forced change is a customer-communication problem and changes project scope. |
| Which outbound messages do we send outside the 24-hour window? | Each becomes a template requiring approval and carrying cost. Needed before we can estimate spend or approval delay. |
| What is our rollback trigger? | Must be defined before migration, not during. What measurable degradation sends us back, and who calls it. |

### Until this is executed

No new features are built on the unofficial client. Anything shipped there before
the migration completes will be rewritten.

---

## Amendment 1 — 2026-08-01: experimental voice-note transcription exception

**Status:** Accepted amendment. This does **not** supersede the transport
migration decision. The customer/production number remains subject to the rule
above: no new features are built on the unofficial client.

Experimental instances may expose voice-note transcription through the current
Baileys transport before migration. This deliberately accepts the rework cost to
validate the voice-note workflow sooner; it is not permission to expand the
unofficial client on customer or production numbers.

The accepted Baileys-specific surface is limited to identifying a PTT voice note
and downloading its audio to an in-memory buffer. The transcription package and
its consumers remain transport-agnostic. When the Cloud API replaces
Baileys, only that detection/download shim should need replacement.
