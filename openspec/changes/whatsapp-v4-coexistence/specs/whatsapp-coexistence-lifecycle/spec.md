# WhatsApp Coexistence Lifecycle Specification

## Purpose

Authentic, replay-safe coexistence lifecycle and Business-app echo behavior.

## Requirements

### Requirement: Authentic monotonic lifecycle

First-party coexistence webhooks MUST require the configured Meta application signature. Invalid/missing signatures MUST be rejected before routing or mutation. `account_update` transitions MUST be monotonic and idempotent.

#### Scenario: Invalid signature

- GIVEN an invalid or absent application signature
- WHEN the webhook is received
- THEN it is rejected without tenant or state mutation

#### Scenario: Replay or stale event

- GIVEN a lifecycle event was already applied
- WHEN it or an older event is delivered
- THEN processing is idempotent and state does not move backward

### Requirement: Echo mutation and disconnection

`smb_message_echoes` MUST preserve message identity and apply supported edit/revoke events to the original without duplication, retaining manual-reply handoff. Revocation, rejection, or offboarding MUST disconnect and prevent sending without fallback. Owner disconnect MUST remove usable credentials idempotently; status/reason MUST be observable.

#### Scenario: Echo mutation

- GIVEN an original echo exists
- WHEN edit or revoke is delivered twice
- THEN the message reaches the final state once

#### Scenario: Revocation

- GIVEN an active coexistence connection
- WHEN Meta reports revocation or offboarding
- THEN it disconnects, cannot send, and does not fallback

External validation boundary: lifecycle fields and meanings require authenticated Meta fixture validation.
