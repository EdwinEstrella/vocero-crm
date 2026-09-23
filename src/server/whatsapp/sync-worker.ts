import { and, eq, inArray, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import type { WebhookChange, WebhookPayload } from "@/server/inbox/webhook";
import { ingestHistoricalMessages, processEchoesValue } from "@/server/inbox/ingest";
import {
  classifyDeliveryFailure,
  computeRetryAt,
  decodeCoexistenceDelivery,
  deliveryEventKey,
  nextCoexistenceStatus,
} from "@/server/whatsapp/lifecycle";

function idsFor(change: WebhookChange): string[] {
  return [
    ...(change.value?.messages ?? []).map((message) => message.id),
    ...(change.value?.message_echoes ?? []).map((message) => message.id),
  ];
}

/** Persists only admitted, claim-routable coexistence work before webhook acknowledgement. */
export async function enqueueCoexistencePayload(payload: WebhookPayload): Promise<void> {
  const db = getDb();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const delivery = decodeCoexistenceDelivery(change);
      if (!delivery || delivery.kind === "unsupported") continue;
      const claims = await db
        .select({ organizationId: schema.whatsappCoexistenceClaim.organizationId })
        .from(schema.whatsappCoexistenceClaim)
        .where(eq(schema.whatsappCoexistenceClaim.phoneNumberId, delivery.phoneNumberId))
        .limit(1);
      const claim = claims[0];
      if (!claim) continue;
      await db
        .insert(schema.whatsappCoexistenceDelivery)
        .values({
          id: newId("coexistenceDelivery"),
          organizationId: claim.organizationId,
          eventKey: deliveryEventKey(claim.organizationId, delivery.kind, delivery.phoneNumberId, idsFor(change)),
          kind: delivery.kind,
          payload: change,
        })
        .onConflictDoNothing();
    }
  }
}

/** Drains a bounded DB inbox so webhook requests never execute lifecycle work. */
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
  for (const row of rows) {
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
  return rows.length;
}

async function processDelivery(row: typeof schema.whatsappCoexistenceDelivery.$inferSelect): Promise<void> {
  const decoded = decodeCoexistenceDelivery(row.payload);
  if (!decoded) {
    throw new Error("unsupported coexistence delivery");
  }
  const change = row.payload as WebhookChange;
  if (decoded.kind === "echo") {
    await processEchoesValue(change.value ?? {});
    return;
  }
  if (decoded.kind === "history") {
    const value = change.value;
    if (!value?.coexistence?.consented_at) throw new Error("unsupported history without consent");
    await ingestHistoricalMessages({
      organizationId: row.organizationId,
      messages: value.messages ?? [],
      contacts: value.contacts,
    });
    return;
  }
  if (decoded.kind !== "lifecycle") throw new Error("unsupported coexistence delivery");
  const db = getDb();
  const claims = await db
    .select()
    .from(schema.whatsappCoexistenceClaim)
    .where(
      and(
        eq(schema.whatsappCoexistenceClaim.organizationId, row.organizationId),
        eq(schema.whatsappCoexistenceClaim.phoneNumberId, decoded.phoneNumberId)
      )
    )
    .limit(1);
  const claim = claims[0];
  if (!claim) throw new Error("unmapped coexistence delivery");
  const status = nextCoexistenceStatus(claim.status, decoded.event);
  if (status === "pending") throw new Error("unsupported coexistence transition");
  if (status === claim.status) return;
  await db.transaction(async (tx) => {
    await tx
      .update(schema.whatsappCoexistenceClaim)
      .set({ status, updatedAt: new Date() })
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
}
