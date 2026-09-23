# Tasks: WhatsApp Embedded Signup v4 Coexistence

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,300 authored lines plus migration/fixtures |
| 400-line budget risk | High |
| Chained PRs recommended | Yes, but delivery remains one PR |
| Suggested split | Three internal work units in one PR under `size:exception` |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Persistence, flags, owner onboarding | Single PR | `pnpm test -- tests/unit/whatsapp-coexistence-onboarding.test.ts` | N/A: route-level proof precedes live mock | `0015_*.sql`, schema, onboarding files |
| 2 | Signed lifecycle, durable inbox, sync | Single PR | `pnpm test -- tests/unit/whatsapp-coexistence-lifecycle.test.ts tests/unit/whatsapp-history-sync.test.ts` | `pnpm test:e2e` lifecycle/history scenarios | webhook, worker, ingest/send files |
| 3 | UI, fixtures, behavior verification | Single PR | `pnpm test -- tests/unit/whatsapp-v4-fixtures.test.ts` | `pnpm test:e2e` connect/reject/retry/conflict flows | wizard, mocks, self-test, E2E doc |

Approval required before apply: explicit maintainer acceptance of `size:exception` for this single PR; no chain-strategy decision is needed.

## Phase 1: Foundation and Persistence

- [ ] 1.1 RED: add Vitest cases for owner denial, expiry/single-use replay, tenant-scoped status, claim races, redaction, and terminal monotonicity.
- [ ] 1.2 Add `src/lib/db/schema.ts`, `src/lib/db/ids.ts`, and rerunnable `drizzle/0015_whatsapp_v4_coexistence.sql` with `message.import_source`, scoped attempts/claims/deliveries/checkpoints; prove backfill preserves active credentials and marks messages `live`.
- [ ] 1.3 Add `WHATSAPP_EMBEDDED_SIGNUP`, Meta App/config settings, and App Secret validation in `src/lib/env.ts` and `.env.example`; disabled mode remains unchanged.

## Phase 2: Onboarding and Credential State

- [ ] 2.1 RED: lock authenticated Meta fixtures and tests for server exchange, asset verification, subscription failure, competing claims, and atomic replacement.
- [ ] 2.2 Implement `src/server/whatsapp/{coexistence,credentials}.ts` and `src/lib/meta/client.ts`; encrypt candidates, retain active credentials until confirmation, and erase rejected replacements.
- [ ] 2.3 RED: add route/UI tests for owner-only `start`, `complete`, `disconnect`, status, redaction, and manual fallback.
- [ ] 2.4 Implement `src/app/api/settings/whatsapp/{route.ts,test/route.ts,start/route.ts,complete/route.ts,disconnect/route.ts}` and `src/components/settings/whatsapp-wizard.tsx`; expose redacted reason/count/expiry data.

## Phase 3: Lifecycle and Side-Effect-Free Sync

- [ ] 3.1 RED: test invalid signatures, durable-before-200, lease recovery/backoff/dead delivery, stale lifecycle events, duplicate edit/revoke, no-consent, isolation, and no CRM side effects.
- [ ] 3.2 Implement fixture-derived decoders, `src/server/whatsapp/{lifecycle,sync-worker}.ts`, `src/server/inbox/webhook.ts`, `src/app/api/webhooks/wa/[webhookToken]/route.ts`, and `src/instrumentation-node.ts`; reject unsupported/unmapped payloads without mutation.
- [ ] 3.3 Update `src/server/inbox/{ingest,send}.ts` for echo edit/revoke and disconnected-send blocking; import via identity/upsert primitives only.

## Phase 4: Verification and Rollout

- [ ] 4.1 RED then green: extend `src/app/api/dev/wa-mock/*`, `tests/unit/*`, `scripts/e2e-selftest.mjs`, and `tests/e2e/whatsapp-v4-coexistence.md` for success, conflict, retry, rejection/revocation, invalid signature, and out-of-order history.
- [ ] 4.2 Run `pnpm typecheck && pnpm lint && pnpm build && pnpm test && pnpm test:e2e`; verify disabled rollout, authenticated fixture admission, bounded worker metrics, and rollback by flag-off/manual setup.

## Apply Status

No implementation task is marked complete: strict-TDD now covers owner-safe redaction, stable delivery keys, bounded retry classification, fixture-locked echo edit/revoke admission, historical group exclusion, terminal send blocking, owner-gated Embedded Signup presentation, and development-only lifecycle/history payload builders. The settings API exposes the public Meta App/config IDs and redacted coexistence status only to an owner while the browser starts the documented `whatsapp_business_app_onboarding` popup and never trusts browser asset IDs or codes. A dev-gated coexistence control delivers narrow signed lifecycle/history payloads through the real webhook but labels itself `development-only`; it cannot satisfy authenticated-fixture admission. Owner-only start/complete/disconnect routes, a durable lifecycle/history inbox drainer, a side-effect-free historical persistence path, and idempotent echo mutation are present. However, required authenticated Meta fixtures, DB race/route coverage, end-to-end browser completion, and behavior harness coverage remain incomplete, so no checkbox has sufficient cumulative evidence. The repository-wide lint gate is currently blocked by pre-existing errors under `.kilo/worktrees/infrequent-gilmoreosaurus/`.
