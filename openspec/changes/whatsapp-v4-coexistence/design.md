# Design: WhatsApp Embedded Signup v4 Coexistence

## Technical Approach

Add an off-by-default `WHATSAPP_EMBEDDED_SIGNUP` module beside manual setup. Attempts, phone claims, encrypted candidates, and a PostgreSQL webhook inbox isolate untrusted input. Existing credentials remain sendable until fixture-validated confirmation; confirmation swaps them atomically, while rejection/revocation deletes all usable credentials without fallback.

## Architecture Decisions

| Option | Tradeoff | Decision |
|---|---|---|
| Extend the active credential row with pending data | Cannot safely preserve the active channel | Separate attempts/candidates and claims; `meta_credentials` remains active-only |
| Process new fields in `after()` | Fast response but loses work after acknowledgement | Persist mapped deliveries before `200`, then drain a bounded DB inbox |
| Reuse live ingestion | Would trigger unread, lead, SSE, and AI effects | Dedicated history importer sharing only identity/upsert primitives |
| Infer payload fields | Quick but unsafe across undocumented variants | Fixture-derived Zod adapters; unknown shapes become observable `unsupported`, never mutate state |

## Data Flow

```text
Owner → start → bound attempt → Meta v4 → complete → exchange/verify
                                             ↓ transaction
                              provisional claim + encrypted candidate
Signed webhook → validate → resolve claim → durable delivery → 200
                                                ↓ bounded worker
                 confirm → atomic credential swap | reject/revoke → disconnect
                                                ↓
                              history/contact side-effect-free upserts
```

Attempts bind `organization_id`, owner `user_id`, hashed state/nonce, expiry, and single-use consumption. Completion exchanges the code server-side, verifies assets through `graphRequest`, subscribes fields, and transactionally inserts a unique phone claim. Same-attempt replay returns its result; another tenant receives non-leaking `409`. Tokens/codes are redacted; candidate and active tokens use existing AES-256-GCM.

## File Changes

| File | Action | Description |
|---|---|---|
| `src/lib/db/schema.ts`, `src/lib/db/ids.ts`, `drizzle/0015_*.sql` | Modify/Create | Add scoped attempts, phone claims, lifecycle status, webhook deliveries/checkpoints, and `message.import_source` |
| `src/server/whatsapp/{coexistence,credentials,lifecycle,sync-worker}.ts` | Create/Modify | State machine, transactions, credential erasure, claims, retry worker |
| `src/lib/meta/client.ts`, `src/server/inbox/webhook.ts` | Modify | Code-exchange support and fixture-derived decoders without speculative fields |
| `src/app/api/webhooks/wa/[webhookToken]/route.ts` | Modify | Mandatory signature in first-party mode; durable routing before acknowledgement |
| `src/app/api/settings/whatsapp/{route.ts,test/route.ts,start/route.ts,complete/route.ts,disconnect/route.ts}` | Modify/Create | Owner-only manual and coexistence operations/status |
| `src/server/inbox/ingest.ts`, `src/server/inbox/send.ts` | Modify | Echo edit/revoke and disconnected send guard; isolated historical import |
| `src/instrumentation-node.ts` | Modify | Start one lease-safe bounded inbox drainer per process |
| `src/components/settings/whatsapp-wizard.tsx` | Modify | Owner-only launch, pending/failed/sync status, retry/disconnect; retain manual fallback |
| `src/lib/env.ts`, `.env.example` | Modify | Flag, Meta App ID/config ID; require App Secret when enabled |
| `src/app/api/dev/wa-mock/*`, `tests/unit/*`, `scripts/e2e-selftest.mjs`, `tests/e2e/whatsapp-v4-coexistence.md` | Modify/Create | Deterministic Meta fixtures and behavior coverage |

## Interfaces / Contracts

Statuses are `pending → awaiting_confirmation → active` or terminal `rejected | revoked | disconnected`; terminal transitions cannot reactivate. Reconnect requires a new attempt. Owner-only APIs return redacted status/reason, sync counts, last success/error, and candidate expiry—never tokens, codes, payloads, or another tenant’s identity. Delivery rows use `(organization_id, event_key)` uniqueness, leases, attempt count, `next_attempt_at`, and `pending|processing|succeeded|retryable|dead|unsupported`. Retries use capped exponential backoff; poison deliveries become `dead` without blocking webhook traffic. Unmapped signed deliveries are redacted/rejected without mutation.

History requires recorded consent and a verified live claim. Out-of-order chunks upsert by WhatsApp message ID; contacts update only profile-owned fields. Imports never change unread/lead activity/live `lastMessageAt`, publish SSE, or invoke AI. Exact lifecycle, consent, chunk, edit, and revoke mappings are enabled only after authenticated Meta fixtures validate their shape and meaning.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | owner guard, expiry/replay, state monotonicity, decoders, backoff, edit/revoke | Vitest RED tests with locked fixtures |
| DB/route | racing claims, scoped reads, atomic swap/erase, durable-before-200, lease recovery | Vitest against test PostgreSQL and route handlers |
| E2E | connect/replace, retries/conflict, rejection/revocation disconnect, invalid signature, out-of-order duplicate history/no side effects | Extend wa-mock and self-test |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A: no executable-file classification | None | None |
| Git repository selection | N/A: no VCS execution | None | None |
| Commit state | N/A: no commit automation | None | None |
| Push state | N/A: no push automation | None | None |
| PR commands | N/A: no PR automation | None | None |

## Migration / Rollout

The additive migration backfills active claims from `meta_credentials`, defaults existing messages to `live`, and is re-runnable. Deploy disabled, validate authenticated fixtures/configuration, enable, then monitor dead/retry counts. Rollback disables the flag and worker, preserves audit rows, and keeps manual setup; terminal rejection/revocation credentials are never restored. This single-PR scope is expected to exceed 400 reviewed lines and requires the proposal’s explicit `size:exception` before apply.

## Open Questions

None; authenticated fixture validation is an implementation admission gate, not permission to assume payload fields.
