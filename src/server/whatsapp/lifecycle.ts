import { createHash } from "node:crypto";
import { z } from "zod";

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
  phoneNumberId: string,
  messageIds: string[]
): string {
  const canonical = messageIds.slice().sort().join(",");
  return createHash("sha256")
    .update(`${organizationId}\u0000${kind}\u0000${phoneNumberId}\u0000${canonical}`, "utf8")
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

const deliverySchema = z.object({
  field: z.enum(["account_update", "smb_message_echoes", "history", "smb_app_state_sync"]),
  value: z.object({
    metadata: z.object({ phone_number_id: z.string().min(1) }),
    coexistence: z.object({ event: z.enum(["confirmed", "rejected", "revoked", "disconnected"]).optional(), consented_at: z.string().datetime().optional() }).optional(),
    message_echoes: z.array(z.object({ id: z.string().min(1) }).passthrough()).optional(),
    messages: z.array(z.object({ id: z.string().min(1) }).passthrough()).optional(),
  }),
});

export type CoexistenceDelivery =
  | { kind: "lifecycle"; phoneNumberId: string; event: LifecycleEvent }
  | { kind: "echo"; phoneNumberId: string }
  | { kind: "history"; phoneNumberId: string }
  | { kind: "unsupported"; phoneNumberId: string };

/**
 * This is intentionally a small, fixture-derived admission boundary. Extend it
 * only with authenticated fixtures; unrecognised data is not inferred.
 */
export function decodeCoexistenceDelivery(input: unknown): CoexistenceDelivery | null {
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) return null;
  const { field, value } = parsed.data;
  if (field === "account_update" && value.coexistence?.event) {
    return {
      kind: "lifecycle",
      phoneNumberId: value.metadata.phone_number_id,
      event: value.coexistence.event,
    };
  }
  if (field === "smb_message_echoes" && (value.message_echoes?.length ?? 0) > 0) {
    return { kind: "echo", phoneNumberId: value.metadata.phone_number_id };
  }
  if (
    field === "history" &&
    typeof value.coexistence?.consented_at === "string" &&
    (value.messages?.length ?? 0) > 0
  ) {
    return { kind: "history", phoneNumberId: value.metadata.phone_number_id };
  }
  if (field === "history") return null;
  return { kind: "unsupported", phoneNumberId: value.metadata.phone_number_id };
}
