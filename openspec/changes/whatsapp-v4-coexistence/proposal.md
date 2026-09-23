# Proposal: WhatsApp Embedded Signup v4 Coexistence

## Intent

Let organization owners connect an existing WhatsApp Business app number through Embedded Signup v4, retain Business app use, and synchronize consented history/contacts. Preserve the active channel until Meta confirms its replacement.

## Scope

### In Scope
- Owner-only onboarding, replacement, status, and disconnect; manual setup remains available.
- Server-side exchange, asset verification/subscription, encrypted credentials, atomic claims, and idempotent callbacks.
- `account_update`, `smb_message_echoes` (including edit/revoke), `history`, and `smb_app_state_sync` handling.
- Bounded history/contact processing without unread, lead-activity, realtime, or AI side effects.
- Preserve the prior channel until confirmation; rejection or revocation disconnects without fallback.

### Out of Scope
- Replacing manual setup, changing Graph API `v25.0`, group-history import, or adding external queues.
- Multiple active WhatsApp numbers per organization.

## Capabilities

### New Capabilities
- `whatsapp-coexistence-onboarding`: Owner-authorized v4 connection and replacement.
- `whatsapp-coexistence-lifecycle`: Verified lifecycle, echo mutation, revocation, and disconnect behavior.
- `whatsapp-history-contact-sync`: Consented, tenant-scoped historical message and contact synchronization.

### Modified Capabilities
None; `openspec/specs/` has no existing capability specs.

## Approach

Use organization-bound, expiring, single-use attempts. Verify Meta assets before transactionally claiming the unique phone-number ID and activating encrypted credentials. Persist scoped attempts and webhook checkpoints; process deliveries through bounded in-process work.

**Meta-documented:** v4 is an Embedded Signup flow; coexistence uses `whatsapp_business_app_onboarding`; history is consented, out-of-order, up to 180 days, and requires prompt acknowledgement.

**Assumptions:** one phone per organization, PostgreSQL as work inbox, manual fallback retained, and imports remain side-effect-free. Exact payloads and eligibility require authenticated Meta validation during design.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/api/settings/whatsapp/*`, `src/components/settings/whatsapp-wizard.tsx` | Modified | Owner-only onboarding and UX |
| `src/server/whatsapp/`, `src/server/inbox/`, webhook route | Modified | Verification, routing, lifecycle, sync |
| `src/lib/db/schema.ts`, `drizzle/`, env and test mocks | Modified | Scoped persistence, configuration, fixtures |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Meta eligibility/payload uncertainty | High | Authenticated validation and fixture locking before apply |
| Cross-tenant claim or replay | High | Transactions, uniqueness, owner checks, signed/idempotent callbacks |
| Single PR exceeds 400 reviewed lines | High | Forecast a substantial exception; apply requires explicit `size:exception` acceptance |

## Rollback Plan

Disable Embedded Signup and new sync processing, retain additive audit data, and restore manual setup. Never restore credentials after Meta rejection or revocation.

## Dependencies

- Approved Meta app/configuration, App Secret signature enforcement, and authenticated v4 payload fixtures.

## Success Criteria

- [ ] Only owners connect/replace; duplicates and cross-tenant claims are safe.
- [ ] Confirmed coexistence activates atomically; rejection/revocation disconnects.
- [ ] History/contacts synchronize idempotently without current-conversation side effects.
- [ ] Mocked E2E covers success, retries, conflicts, revocation, and out-of-order history.
