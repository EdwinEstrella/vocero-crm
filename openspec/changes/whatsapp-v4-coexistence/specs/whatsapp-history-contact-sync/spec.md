# WhatsApp History and Contact Sync Specification

## Purpose

Consented, tenant-isolated synchronization without conversation side effects.

## Requirements

### Requirement: Consent-bound history

History MUST require customer consent and handle out-of-order chunks, the documented preceding-180-day/no-group boundaries, and message identity. Import MUST NOT create unread counts, lead activity, realtime “new message” events, or AI invocations.

#### Scenario: Out-of-order history

- GIVEN consented chunks arrive out of order with duplicate IDs
- WHEN they are processed
- THEN eligible messages are stored once without conversation side effects

#### Scenario: No consent

- GIVEN a delivery lacks recorded consent
- WHEN it is received
- THEN rejection is observable and no messages or contacts are imported

### Requirement: Scoped durable recovery

`smb_app_state_sync` and history MUST use the verified organization/phone claim. Unmapped deliveries MUST be rejected or quarantined. Each delivery/checkpoint MUST be durable before acknowledgement; bounded retries MUST be idempotent, observable, and side-effect-free.

#### Scenario: Tenant isolation

- GIVEN two organizations have distinct phone claims
- WHEN each receives sync deliveries
- THEN each observes only its own data

#### Scenario: Transient failure

- GIVEN a recorded chunk fails transiently
- WHEN retry runs
- THEN it resumes, completes once, and reports its outcome

External validation boundary: payloads, consent markers, chunk semantics, and eligibility require authenticated Meta fixture validation.
