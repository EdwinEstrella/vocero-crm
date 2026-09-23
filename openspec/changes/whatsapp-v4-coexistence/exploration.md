## Exploration: WhatsApp Embedded Signup v4 and Business App coexistence

### Current State

#### Official Meta facts

The phrase “WhatsApp API v4” is ambiguous. In Meta's current documentation, **v4 is the Embedded Signup flow version**, not Graph API v4. Vocero currently calls Graph API `v25.0`; that transport version is a separate concern.

- Embedded Signup v4 was released on October 8, 2025. Meta documents October 15, 2026 as the deprecation date for v2/v3 and their public previews. Upgrading requires a new Facebook Login for Business configuration. V4 moves phone-number entry and verification to the start of the flow (“Phone Number First”). [Version 4](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4) · [Versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions)
- Meta's Business App onboarding flow lets a customer connect an existing WhatsApp Business app account and number to Cloud API while retaining one-to-one use of the Business app. The coexistence feature is selected with `featureType: "whatsapp_business_app_onboarding"`. The customer confirms the connection in the Business app and independently chooses whether to share chat history. [Onboard WhatsApp Business app users](https://developers.facebook.com/docs/whatsapp/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- Embedded Signup returns an authorization code and session information containing the WABA ID and business phone-number ID. The code must be sent to the backend and exchanged server-to-server for a business integration system-user token; the target WABA must then be subscribed to the app. Client-returned asset IDs are not credentials. [Implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- Coexistence relies on additional WABA webhook fields: `smb_message_echoes` for Business-app-originated messages, `history` for consented history import, `smb_app_state_sync` for app state/contact synchronization, and `account_update` for account lifecycle changes. An offboarded/reconnected account is reported through account lifecycle events; exact payloads must be fixture-locked against the version selected in the Meta dashboard before implementation.
- `smb_message_echoes` uses the standard WABA envelope and `message_echoes[]`; each message has a WhatsApp message ID. Meta documents text, image, video, document, edit, and revoke events, with edit/revoke referring to the original message. [SMB message echoes](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components/smb-message-echoes)
- If the customer consents, history delivery can cover the preceding 180 days, excludes groups, is split into phases/chunks that may arrive out of order, and can contain thousands of messages. Media IDs are delivered separately only for recent media (up to 14 days). Meta recommends acknowledging immediately and processing asynchronously. [History webhooks](https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components/history)

Facts above come only from Meta developer documentation. Meta pages were discoverable/indexed but direct anonymous fetching returned HTTP 400, so exact payload examples and availability/eligibility matrices should be revalidated in an authenticated Meta developer session during design.

#### Vocero today

Vocero has no first-party Embedded Signup implementation. The settings wizard accepts a WABA ID, phone-number ID, and access token manually, validates the token against the phone-number node, encrypts it, upserts one connection per organization, and best-effort subscribes the app without overwriting an existing WABA callback override.

Inbound routing is global by the unique `phone_number_id`, then all created records carry the resolved `organization_id`. Tokens use AES-256-GCM. Normal messages and current manual-message echoes deduplicate globally by `message.wa_message_id`; echoes pause the AI. The webhook validates a secret URL segment and validates `x-hub-signature-256` only when `META_APP_SECRET` is configured.

Existing coexistence support is partial: `smb_message_echoes` is parsed, but edit/revoke are ignored; `account_update`, `history`, and `smb_app_state_sync` are ignored. There is no durable onboarding attempt, OAuth state/nonce, token-expiry metadata, lifecycle event inbox, history checkpoint, offboarding handler, disconnect flow, or Meta App/Configuration ID environment contract. WhatsApp credential mutation is authenticated but, unlike Messenger settings, is not owner-only.

#### Lifecycle mapped to Vocero

1. **Start** — owner requests a short-lived, organization-bound onboarding attempt; server issues state/nonce and the client launches v4 with the public configuration ID and coexistence feature type.
2. **Meta flow** — customer authenticates, enters the existing Business-app number, confirms connection in the app, and chooses history sharing. Vocero treats browser messages/session info as untrusted until server verification.
3. **Complete** — backend atomically consumes the one-time state, exchanges the code with Meta using the server-only App Secret, verifies WABA/phone ownership through Graph, subscribes required webhook fields, then claims the unique phone number for the tenant and stores the encrypted token.
4. **Activate** — persist connection mode and lifecycle state only after required verification/subscription succeeds; retries return the same connection instead of creating a second one.
5. **Operate** — route by phone-number ID, dedupe messages by WhatsApp ID, apply edit/revoke idempotently, and apply account lifecycle transitions monotonically. Echoes retain the existing `manual_reply` AI handoff behavior.
6. **History/state sync** — first durably record each delivery/checkpoint, acknowledge quickly, then process in bounded in-process work. Historical messages must not increment unread counts, create current lead activity, emit “new message” UX events, or invoke the AI.
7. **Offboard/reconnect/disconnect** — lifecycle webhooks move the connection to a non-sending state; reconnection restores it only after verified evidence. Local disconnect revokes/removes usable credentials and must be idempotent. Meta-side unsubscribe/deletion behavior needs an explicit product decision and authenticated-doc confirmation.

**Implementation assumptions (not Meta facts):** Vocero will retain its one-phone-per-organization model; manual credential entry remains as a self-hosted fallback; PostgreSQL acts as the durable work inbox because external queues are constitutionally excluded; and importing contacts/history is product-optional even though coexistence webhook support is available.

### Affected Areas
- `src/components/settings/whatsapp-wizard.tsx` — add owner-only v4 launch/progress/reconnect UI while preserving manual fallback.
- `src/app/api/settings/whatsapp/*` — start/complete/status/disconnect endpoints, strict Zod validation, one-time state consumption, and owner authorization.
- `src/server/whatsapp/connect.ts` — code exchange, asset verification, required WABA subscriptions, reconciliation, and typed Meta failures.
- `src/server/whatsapp/credentials.ts` — atomic tenant claim, lifecycle transitions, token metadata, and conflict-safe idempotent upserts.
- `src/app/api/webhooks/wa/[webhookToken]/route.ts` — dispatch account, history, state-sync, edit, and revoke events after signature verification.
- `src/server/inbox/ingest.ts` and `src/server/inbox/webhook.ts` — coexistence payload contracts, historical-ingest semantics, and monotonic/idempotent mutations.
- `src/lib/db/schema.ts` and `drizzle/` — versioned additive migration for onboarding attempts, connection/lifecycle metadata, and a durable webhook/history inbox or checkpoints; every domain row remains organization-scoped.
- `src/lib/crypto/index.ts` — reuse the single AES-256-GCM mechanism; no new encryption scheme is needed.
- `src/lib/env.ts` and `.env.example` — public Meta App/Configuration IDs plus server-only App Secret guidance; first-party onboarding must require signature verification.
- `src/app/api/dev/wa-mock/*`, `src/server/dev/*`, `tests/unit/*`, and `scripts/e2e-selftest.mjs` — simulate code exchange, retries, tenant conflicts, account transitions, out-of-order history, duplicate echoes, edits/revokes, and invalid signatures/state.

### Approaches
1. **Add first-party v4 coexistence beside the manual connector** — Vocero owns state, code exchange, verification, persistence, webhook subscriptions, and lifecycle handling; manual credentials remain available when app configuration is absent.
   - Pros: Secure end-to-end ownership, compatible with self-hosting, uses existing Graph/encryption/routing seams, no new third party, and preserves rollback.
   - Cons: Requires Meta app review/configuration, schema and mock expansion, lifecycle operations, and substantially more than the 400-line review budget if history/contact sync is included immediately.
   - Effort: High

2. **Keep Embedded Signup external and only harden the import contract** — an agency platform completes v4 and supplies verified assets/token to Vocero through a server API.
   - Pros: Smaller change and avoids browser SDK/configuration work in each Vocero instance.
   - Cons: Does not meet a first-party connection lifecycle, preserves manual secret transfer, complicates trust/tenant binding, and leaves offboarding/history coupling split across systems.
   - Effort: Medium

3. **Replace manual setup with v4-only onboarding** — make Embedded Signup the sole connection path.
   - Pros: Simplest long-term UX and one lifecycle model.
   - Cons: Weakens self-hosted/direct-mode recovery, raises deployment and app-review coupling, and creates a risky migration for existing credentials.
   - Effort: High

### Recommendation
Choose approach 1 with an additive state machine and manual fallback. The secure boundary is a server-owned, single-use onboarding attempt bound to `organization_id`, `user_id`, expiry, and nonce; the completion transaction must verify Meta assets before atomically claiming the globally unique phone-number ID. Only owners may initiate, complete, rotate, or disconnect credentials.

Use existing `meta_credentials` as the active connection record, extended with connection mode, lifecycle status, token expiry/metadata where Meta supplies it, and verified timestamps. Use separate organization-scoped tables for short-lived onboarding attempts and durable webhook/history deliveries rather than overloading credentials. Store no App Secret or plaintext access token outside server memory/encrypted columns; redact authorization codes and tokens from logs.

For idempotency, use database uniqueness plus transactional state transitions: one active attempt token, one phone-number claim, one webhook delivery identity/checkpoint, and one message per WhatsApp message ID. Duplicate completion must return the existing verified connection; cross-tenant phone claims must return a deliberate 409 without revealing the owning tenant. Lifecycle transitions must reject stale events, and history import must use a side-effect-free ingest path.

The full scope is not credible under 400 reviewed lines. With the fixed `single-pr` strategy, proposal must either (a) limit the first change to secure v4 onboarding plus account/echo lifecycle and explicitly defer history/contact import, or (b) record an approved review-budget exception. Internal commits alone do not solve review load.

### Risks
- Meta documentation access, app eligibility, review approval, and dashboard configuration can block live verification; exact v4/coexistence payload fixtures remain a design prerequisite.
- Optional webhook signatures are insufficient for a first-party shared Meta app; enabling onboarding without a configured App Secret would expose a tenant-routing attack surface.
- Current WhatsApp settings let any member replace credentials; extending that behavior to OAuth would enable account takeover inside an organization.
- Global routing lookups are intentional but dangerous without database uniqueness and verified atomic tenant claims; naive check-then-insert creates a cross-tenant race.
- History payload size and out-of-order delivery exceed the assumptions of the current `after()` processing path; direct ingestion could time out, duplicate side effects, or trigger the AI on old messages.
- Existing echo support silently drops Meta-documented edit/revoke events and may overstate support for payload types not confirmed by the current docs.
- One-pr delivery of onboarding, lifecycle, history, state sync, UI, mocks, migration, and E2E coverage is a high review-budget risk.

### Ready for Proposal
Yes, with two explicit proposal constraints: treat “v4” as Embedded Signup v4 while retaining the independently versioned Graph client, and resolve scope against the 400-line single-PR budget before apply. The proposal should define secure onboarding/account lifecycle as the minimum coherent slice and state whether consented history/contact sync is deferred or receives a size exception.
