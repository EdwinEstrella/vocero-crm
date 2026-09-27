import { and, eq, inArray, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isOrganizationSuspended } from "@/server/platform/suspension";
import type { WebhookChange, WebhookPayload } from "@/server/inbox/webhook";
import { ingestHistoricalMessages, processEchoesValue } from "@/server/inbox/ingest";
import {
  applyStateSync,
  markHistoryDeclined,
  recordHistoryProgress,
  requestInitialSync,
} from "@/server/whatsapp/smb-sync";
import {
  classifyDeliveryFailure,
  computeRetryAt,
  decodeCoexistenceDelivery,
  decodeHistoryDelivery,
  decodeStateSync,
  deliveryEventKey,
  nextCoexistenceStatus,
  type CoexistenceDelivery,
} from "@/server/whatsapp/lifecycle";

/** Ids/markers that make two otherwise-identical deliveries distinguishable. */
function distinguishingIdsFor(change: WebhookChange): string[] {
  const value = change.value as Record<string, unknown> | undefined;
  if (change.field === "account_update") {
    const event = (value as { event?: string } | undefined)?.event;
    return event ? [event] : [];
  }
  if (change.field === "smb_app_state_sync") {
    const entries = (value?.state_sync as
      | { contact?: { phone_number?: string }; action?: string; metadata?: { timestamp?: string } }[]
      | undefined) ?? [];
    return entries.map((e) => `${e.action ?? ""}:${e.contact?.phone_number ?? ""}:${e.metadata?.timestamp ?? ""}`);
  }
  if (change.field === "history") {
    const historyEntries = (value?.history as
      | { threads?: { messages?: { id?: string }[] }[]; errors?: { code?: number }[] }[]
      | undefined) ?? [];
    return historyEntries.flatMap((h) => [
      ...(h.errors ?? []).map((e) => `error:${e.code}`),
      ...(h.threads ?? []).flatMap((t) => (t.messages ?? []).map((m) => m.id ?? "")),
    ]);
  }
  return [
    ...((value?.messages as { id: string }[] | undefined) ?? []).map((m) => m.id),
    ...((value?.message_echoes as { id: string }[] | undefined) ?? []).map((m) => m.id),
  ];
}

function routeKeyFor(delivery: CoexistenceDelivery): string {
  return delivery.kind === "lifecycle" || delivery.kind === "account_noop"
    ? delivery.wabaId
    : delivery.phoneNumberId;
}

/** Resolves the tenant for an admitted delivery — never a global org fallback. */
async function resolveDeliveryOrganization(delivery: CoexistenceDelivery): Promise<string | null> {
  const db = getDb();
  if (delivery.kind === "lifecycle" || delivery.kind === "account_noop") {
    const rows = await db
      .select({ organizationId: schema.whatsappCoexistenceClaim.organizationId })
      .from(schema.whatsappCoexistenceClaim)
      .where(eq(schema.whatsappCoexistenceClaim.wabaId, delivery.wabaId))
      .limit(1);
    return rows[0]?.organizationId ?? null;
  }
  const rows = await db
    .select({ organizationId: schema.whatsappCoexistenceClaim.organizationId })
    .from(schema.whatsappCoexistenceClaim)
    .where(eq(schema.whatsappCoexistenceClaim.phoneNumberId, delivery.phoneNumberId))
    .limit(1);
  return rows[0]?.organizationId ?? null;
}

/**
 * Persists only admitted, claim-routable coexistence work before webhook
 * acknowledgement. `account_update` is queued even for a suspended
 * organization (FR-041 exempts it); every other kind is dropped with a log
 * before it ever reaches the durable mailbox.
 */
export async function enqueueCoexistencePayload(payload: WebhookPayload): Promise<void> {
  const db = getDb();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const delivery = decodeCoexistenceDelivery(change);
      if (!delivery) continue;

      const organizationId = await resolveDeliveryOrganization(delivery);
      if (!organizationId) {
        console.warn(
          `[webhook] WABA/número desconocido para coexistence (${delivery.kind}): descartado`
        );
        continue;
      }

      const isAccountUpdate = delivery.kind === "lifecycle" || delivery.kind === "account_noop";
      if (!isAccountUpdate && (await isOrganizationSuspended(organizationId))) {
        console.warn(
          `[webhook] org suspendida (${organizationId}): entrega de coexistence descartada (${delivery.kind})`
        );
        continue;
      }

      await db
        .insert(schema.whatsappCoexistenceDelivery)
        .values({
          id: newId("coexistenceDelivery"),
          organizationId,
          eventKey: deliveryEventKey(
            organizationId,
            delivery.kind,
            routeKeyFor(delivery),
            distinguishingIdsFor(change)
          ),
          kind: delivery.kind,
          payload: change,
        })
        .onConflictDoNothing();
    }
  }
}

/**
 * Drains a bounded DB inbox so webhook requests never execute lifecycle work.
 * Rows for a suspended organization are skipped (left pending) unless they
 * are an `account_update` — WABA-level state must still apply.
 */
export async function drainCoexistenceDeliveries(limit = 20): Promise<number> {
  const db = getDb();
  const now = new Date();
  const rows = await db
    .select()
    .from(schema.whatsappCoexistenceDelivery)
    .where(
      and(
        or(
          eq(schema.whatsappCoexistenceDelivery.status, "pending"),
          eq(schema.whatsappCoexistenceDelivery.status, "retryable")
        ),
        lte(schema.whatsappCoexistenceDelivery.nextAttemptAt, now)
      )
    )
    .limit(limit);
  let processed = 0;
  for (const row of rows) {
    const isAccountUpdate = row.kind === "lifecycle" || row.kind === "account_noop";
    if (!isAccountUpdate && (await isOrganizationSuspended(row.organizationId))) {
      console.warn(`[coexistence] org suspendida (${row.organizationId}): entrega ${row.kind} omitida`);
      continue;
    }
    processed++;
    const lease = new Date(now.getTime() + 60_000);
    const claimed = await db
      .update(schema.whatsappCoexistenceDelivery)
      .set({ status: "processing", attempts: row.attempts + 1, leaseUntil: lease, updatedAt: now })
      .where(
        and(
          eq(schema.whatsappCoexistenceDelivery.id, row.id),
          inArray(schema.whatsappCoexistenceDelivery.status, ["pending", "retryable"])
        )
      )
      .returning();
    if (!claimed[0]) continue;
    try {
      await processDelivery(claimed[0]);
      await db
        .update(schema.whatsappCoexistenceDelivery)
        .set({ status: "succeeded", leaseUntil: null, lastError: null, updatedAt: new Date() })
        .where(eq(schema.whatsappCoexistenceDelivery.id, row.id));
    } catch (error) {
      const outcome = classifyDeliveryFailure(claimed[0].attempts, error);
      await db
        .update(schema.whatsappCoexistenceDelivery)
        .set({
          status: outcome.status,
          leaseUntil: null,
          nextAttemptAt: computeRetryAt(new Date(), claimed[0].attempts),
          lastError: error instanceof Error ? error.message.slice(0, 300) : "delivery failed",
          updatedAt: new Date(),
        })
        .where(eq(schema.whatsappCoexistenceDelivery.id, row.id));
    }
  }
  return processed;
}

async function processDelivery(row: typeof schema.whatsappCoexistenceDelivery.$inferSelect): Promise<void> {
  const change = row.payload as WebhookChange;
  const decoded = decodeCoexistenceDelivery(change);
  if (!decoded) throw new Error("unsupported coexistence delivery");

  if (decoded.kind === "account_noop") {
    console.log(
      `[coexistence] account_update ignorado (${decoded.event}) para WABA ${decoded.wabaId}`
    );
    return;
  }

  if (decoded.kind === "echo") {
    await processEchoesValue(change.value ?? {});
    return;
  }

  if (decoded.kind === "history") {
    const parsed = decodeHistoryDelivery(change.value);
    if (!parsed) throw new Error("unsupported history delivery");
    if (parsed.kind === "declined") {
      await markHistoryDeclined(row.organizationId, decoded.phoneNumberId);
      return;
    }
    await ingestHistoricalMessages({ organizationId: row.organizationId, threads: parsed.threads });
    if (parsed.progress != null) {
      await recordHistoryProgress(row.organizationId, decoded.phoneNumberId, parsed.progress);
    }
    return;
  }

  if (decoded.kind === "state_sync") {
    const parsed = decodeStateSync(change.value);
    if (!parsed) throw new Error("unsupported state_sync delivery");
    await applyStateSync(row.organizationId, parsed);
    return;
  }

  // decoded.kind === "lifecycle"
  const db = getDb();
  const claims = await db
    .select()
    .from(schema.whatsappCoexistenceClaim)
    .where(
      and(
        eq(schema.whatsappCoexistenceClaim.organizationId, row.organizationId),
        eq(schema.whatsappCoexistenceClaim.wabaId, decoded.wabaId)
      )
    )
    .limit(1);
  const claim = claims[0];
  if (!claim) throw new Error("unmapped coexistence delivery");
  const status = nextCoexistenceStatus(claim.status, decoded.event);
  if (status === "pending") throw new Error("unsupported coexistence transition");
  if (status === claim.status) return;

  const activatedAt = status === "active" ? new Date() : null;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.whatsappCoexistenceClaim)
      .set({ status, updatedAt: new Date(), ...(activatedAt ? { activatedAt } : {}) })
      .where(eq(schema.whatsappCoexistenceClaim.id, claim.id));
    await tx
      .update(schema.whatsappCoexistenceAttempt)
      .set({ status, reason: status === "active" ? null : "Connection rejected", updatedAt: new Date() })
      .where(eq(schema.whatsappCoexistenceAttempt.id, claim.attemptId));
    if (status === "active") {
      await tx.insert(schema.metaCredentials).values({
        id: newId("credentials"),
        organizationId: claim.organizationId,
        wabaId: claim.wabaId,
        phoneNumberId: claim.phoneNumberId,
        tokenCipher: claim.tokenCipher,
        tokenIv: claim.tokenIv,
        tokenTag: claim.tokenTag,
        status: "connected",
      }).onConflictDoUpdate({
        target: [schema.metaCredentials.organizationId],
        set: {
          wabaId: claim.wabaId,
          phoneNumberId: claim.phoneNumberId,
          tokenCipher: claim.tokenCipher,
          tokenIv: claim.tokenIv,
          tokenTag: claim.tokenTag,
          status: "connected",
          updatedAt: new Date(),
        },
      });
    }
    if (status === "rejected" || status === "revoked" || status === "disconnected") {
      await tx.delete(schema.metaCredentials).where(eq(schema.metaCredentials.organizationId, claim.organizationId));
    }
  });

  if (status === "active") {
    // Fuera de la transacción (R4/FR-043): la llamada a Meta nunca corre dentro de un commit pendiente.
    await requestInitialSync(row.organizationId).catch((error) => {
      console.error(
        `[coexistence] no se pudo iniciar la sincronización de ${row.organizationId}:`,
        error instanceof Error ? error.message : error
      );
    });
  }
}
