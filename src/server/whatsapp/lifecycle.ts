import { createHash } from "node:crypto";
import { z } from "zod";
import type { WebhookMessage } from "@/server/inbox/webhook";

export type CoexistenceStatus =
  | "pending"
  | "awaiting_confirmation"
  | "active"
  | "rejected"
  | "revoked"
  | "disconnected";

export type LifecycleEvent = "confirmed" | "rejected" | "revoked" | "disconnected";

const terminalStatuses = new Set<CoexistenceStatus>([
  "rejected",
  "revoked",
  "disconnected",
]);

/** Terminal coexistence states are a hard send boundary; no manual fallback. */
export function canSendWithCoexistenceStatus(status: CoexistenceStatus): boolean {
  return !terminalStatuses.has(status);
}

/** Applies only forward lifecycle transitions. Unknown or stale events are no-ops. */
export function nextCoexistenceStatus(
  current: CoexistenceStatus,
  event: LifecycleEvent
): CoexistenceStatus {
  if (terminalStatuses.has(current)) return current;
  if (event === "confirmed") {
    return current === "awaiting_confirmation" ? "active" : current;
  }
  return event;
}

/** Never put provider payloads, codes, or tokens into observable status text. */
export function redactCoexistenceReason(reason: string | null | undefined): string | null {
  return reason?.trim() ? "Connection rejected" : null;
}

/** Capped backoff makes poison inbox rows observable without holding webhook requests. */
export function computeRetryAt(now: Date, attempts: number): Date {
  const delayMs = Math.min(60 * 60 * 1000, 5_000 * 2 ** Math.max(0, attempts - 1));
  return new Date(now.getTime() + delayMs);
}

/** A stable, tenant-scoped dedupe key; raw provider payloads never form a key. */
export function deliveryEventKey(
  organizationId: string,
  kind: string,
  routeKey: string,
  distinguishingIds: string[]
): string {
  const canonical = distinguishingIds.slice().sort().join(",");
  return createHash("sha256")
    .update(`${organizationId}\u0000${kind}\u0000${routeKey}\u0000${canonical}`, "utf8")
    .digest("hex");
}

/** Keeps malformed/unsupported work out of retry loops while bounding outages. */
export function classifyDeliveryFailure(
  attempts: number,
  error: unknown
): { status: "retryable" | "dead" | "unsupported" } {
  const message = error instanceof Error ? error.message : String(error);
  if (/unsupported|malformed|unmapped/i.test(message)) return { status: "unsupported" };
  return attempts >= 5 ? { status: "dead" } : { status: "retryable" };
}

const echoMutationSchema = z.object({
  context: z.object({ id: z.string().min(1) }),
  edit: z.object({ body: z.string().min(1) }).optional(),
  revoke: z.literal(true).optional(),
}).passthrough();

/**
 * Admits only the fixture-locked mutation forms. The mutation always targets
 * Meta's original message id; a new echo id must never create a duplicate.
 */
export function decodeEchoMutation(input: unknown):
  | { kind: "edit"; originalMessageId: string; text: string }
  | { kind: "revoke"; originalMessageId: string }
  | null {
  const parsed = echoMutationSchema.safeParse(input);
  if (!parsed.success) return null;
  if (parsed.data.edit) {
    return {
      kind: "edit",
      originalMessageId: parsed.data.context.id,
      text: parsed.data.edit.body,
    };
  }
  return parsed.data.revoke
    ? { kind: "revoke", originalMessageId: parsed.data.context.id }
    : null;
}

/** Historical group messages are outside the coexistence import contract. */
export function historyMessageIsEligible(input: { id?: string; from?: string; type?: string }): boolean {
  return Boolean(input.id && input.from && !input.from.endsWith("@g.us"));
}

/* -------------------------------------------------------------------------
 * Real Meta payload decoders (contracts/webhook-smb.md, R2/R3 of plan.md).
 * Each decoder admits exactly the shape Meta documents for its field; an
 * unrecognised or malformed value is `null`, never inferred.
 * ---------------------------------------------------------------------- */

const ACCOUNT_UPDATE_EVENT_MAP: Record<string, LifecycleEvent | undefined> = {
  PARTNER_ADDED: "confirmed",
  PARTNER_APP_INSTALLED: "confirmed",
  PARTNER_REMOVED: "revoked",
  PARTNER_APP_UNINSTALLED: "revoked",
  ACCOUNT_OFFBOARDED: "disconnected",
  ACCOUNT_DELETED: "disconnected",
};

const accountUpdateValueSchema = z.object({
  event: z.string().min(1),
  waba_info: z.object({ waba_id: z.string().min(1) }).passthrough(),
}).passthrough();

export type AccountUpdateDecision =
  | { kind: "lifecycle"; wabaId: string; event: LifecycleEvent }
  /** ACCOUNT_RECONNECTED and any other unmapped event: logged, no state effect (T040/R3). */
  | { kind: "noop"; wabaId: string; event: string };

/**
 * Real `account_update` shape (T040/R3): routed by WABA (`value.waba_info.waba_id`),
 * never `phone_number_id` — Meta does not send it on this field. `PARTNER_ADDED`
 * and `PARTNER_APP_INSTALLED` confirm a claim only when the WABA matches that
 * claim's `waba_id` (enforced by the caller's lookup); claims are org-bound, so
 * a foreign WABA can never confirm another organization's claim.
 */
export function decodeAccountUpdate(value: unknown): AccountUpdateDecision | null {
  const parsed = accountUpdateValueSchema.safeParse(value);
  if (!parsed.success) return null;
  const wabaId = parsed.data.waba_info.waba_id;
  const mapped = ACCOUNT_UPDATE_EVENT_MAP[parsed.data.event];
  if (!mapped) return { kind: "noop", wabaId, event: parsed.data.event };
  return { kind: "lifecycle", wabaId, event: mapped };
}

const stateSyncEntrySchema = z.object({
  type: z.string().optional(),
  contact: z.object({
    full_name: z.string().optional(),
    first_name: z.string().optional(),
    phone_number: z.string().optional(),
  }).optional(),
  action: z.string().optional(),
}).passthrough();

const stateSyncValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1) }).passthrough(),
  state_sync: z.array(z.unknown()).optional(),
}).passthrough();

export type StateSyncContactOp = {
  action: "add" | "remove";
  phoneNumber: string | null;
  fullName: string | null;
  firstName: string | null;
};

export type StateSyncDecision = { phoneNumberId: string; contacts: StateSyncContactOp[] };

/**
 * Real `smb_app_state_sync` shape (R2): only `type: "contact"` entries are
 * admitted. Meta's `edit` is treated the same as `add` (both are an upsert);
 * anything else is dropped without error.
 */
export function decodeStateSync(value: unknown): StateSyncDecision | null {
  const parsed = stateSyncValueSchema.safeParse(value);
  if (!parsed.success) return null;
  const contacts: StateSyncContactOp[] = [];
  for (const raw of parsed.data.state_sync ?? []) {
    const entry = stateSyncEntrySchema.safeParse(raw);
    if (!entry.success || entry.data.type !== "contact") continue;
    const action =
      entry.data.action === "remove"
        ? "remove"
        : entry.data.action === "add" || entry.data.action === "edit"
          ? "add"
          : null;
    if (!action) continue;
    contacts.push({
      action,
      phoneNumber: entry.data.contact?.phone_number ?? null,
      fullName: entry.data.contact?.full_name ?? null,
      firstName: entry.data.contact?.first_name ?? null,
    });
  }
  return { phoneNumberId: parsed.data.metadata.phone_number_id, contacts };
}

const historyThreadSchema = z.object({
  id: z.string().min(1),
  messages: z.array(z.unknown()).default([]),
}).passthrough();

const historyEntrySchema = z.object({
  metadata: z.object({
    phase: z.string().optional(),
    chunk_order: z.union([z.string(), z.number()]).optional(),
    progress: z.union([z.string(), z.number()]).optional(),
  }).optional(),
  threads: z.array(historyThreadSchema).optional(),
  errors: z.array(z.object({ code: z.number() }).passthrough()).optional(),
}).passthrough();

const historyValueSchema = z.object({
  metadata: z.object({ phone_number_id: z.string().min(1) }).passthrough(),
  history: z.array(historyEntrySchema).min(1),
}).passthrough();

/** "History sync is turned off by the business from the WhatsApp Business App". */
const HISTORY_DECLINED_CODE = 2593109;

export type HistoryThread = { id: string; messages: WebhookMessage[] };

export type HistoryDecision =
  | { kind: "declined"; phoneNumberId: string }
  | {
      kind: "threads";
      phoneNumberId: string;
      progress: number | null;
      threads: HistoryThread[];
    };

/** Real `history` shape (R2): nested threads, declined via error code 2593109. */
export function decodeHistoryDelivery(value: unknown): HistoryDecision | null {
  const parsed = historyValueSchema.safeParse(value);
  if (!parsed.success) return null;
  const phoneNumberId = parsed.data.metadata.phone_number_id;
  const declined = parsed.data.history.some((entry) =>
    (entry.errors ?? []).some((e) => e.code === HISTORY_DECLINED_CODE)
  );
  if (declined) return { kind: "declined", phoneNumberId };

  const threads: HistoryThread[] = [];
  let progress: number | null = null;
  for (const entry of parsed.data.history) {
    const rawProgress = entry.metadata?.progress;
    if (rawProgress !== undefined) {
      const n = Number(rawProgress);
      if (Number.isFinite(n)) progress = n;
    }
    for (const thread of entry.threads ?? []) {
      threads.push({ id: thread.id, messages: thread.messages as WebhookMessage[] });
    }
  }
  return { kind: "threads", phoneNumberId, progress, threads };
}

export type CoexistenceDelivery =
  | { kind: "lifecycle"; wabaId: string; event: LifecycleEvent }
  | { kind: "account_noop"; wabaId: string; event: string }
  | { kind: "echo"; phoneNumberId: string }
  | { kind: "history"; phoneNumberId: string }
  | { kind: "state_sync"; phoneNumberId: string };

const changeSchema = z.object({
  field: z.string().optional(),
  value: z.unknown().optional(),
});

/**
 * Top-level admission boundary for the durable coexistence mailbox
 * (contracts/webhook-smb.md). Only the subscribed fields ever reach here;
 * anything else — or a malformed value for one of them — is dropped without
 * error (`null`), never guessed.
 */
export function decodeCoexistenceDelivery(input: unknown): CoexistenceDelivery | null {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return null;
  const { field, value } = parsed.data;
  if (field === "account_update") {
    const decoded = decodeAccountUpdate(value);
    if (!decoded) return null;
    return decoded.kind === "lifecycle"
      ? { kind: "lifecycle", wabaId: decoded.wabaId, event: decoded.event }
      : { kind: "account_noop", wabaId: decoded.wabaId, event: decoded.event };
  }
  if (field === "smb_message_echoes") {
    const v = value as { metadata?: { phone_number_id?: string }; message_echoes?: unknown[] } | undefined;
    const phoneNumberId = v?.metadata?.phone_number_id;
    if (!phoneNumberId || !(v?.message_echoes?.length)) return null;
    return { kind: "echo", phoneNumberId };
  }
  if (field === "history") {
    const decoded = decodeHistoryDelivery(value);
    return decoded ? { kind: "history", phoneNumberId: decoded.phoneNumberId } : null;
  }
  if (field === "smb_app_state_sync") {
    const decoded = decodeStateSync(value);
    return decoded ? { kind: "state_sync", phoneNumberId: decoded.phoneNumberId } : null;
  }
  return null;
}
