import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { decryptSecret } from "@/lib/crypto";
import { graphRequest, MetaApiError, normalizeMx } from "@/lib/meta/client";
import { findWhatsappContact } from "@/server/inbox/identity";
import type { StateSyncDecision } from "@/server/whatsapp/lifecycle";

/**
 * D7/FR-043..044 — Sincronización de contactos e historial de coexistence.
 * Cada llamada a Meta (`POST {phone_number_id}/smb_app_data`) va fuera de
 * toda transacción y se reclama ANTES por UNIQUE
 * (`whatsapp_smb_sync_request`), para que una entrega repetida del webhook
 * jamás dispare una segunda petición (Constitución IV).
 */

const SYNC_WINDOW_MS = 24 * 60 * 60 * 1000;
type SyncType = "smb_app_state_sync" | "history";

type ActiveClaimToken = { phoneNumberId: string; token: string; activatedAt: Date };

async function activeClaimToken(organizationId: string): Promise<ActiveClaimToken | null> {
  const rows = await getDb()
    .select()
    .from(schema.whatsappCoexistenceClaim)
    .where(
      and(
        eq(schema.whatsappCoexistenceClaim.organizationId, organizationId),
        eq(schema.whatsappCoexistenceClaim.status, "active")
      )
    )
    .orderBy(desc(schema.whatsappCoexistenceClaim.activatedAt))
    .limit(1);
  const claim = rows[0];
  if (!claim || !claim.activatedAt) return null;
  return {
    phoneNumberId: claim.phoneNumberId,
    token: decryptSecret({ cipher: claim.tokenCipher, iv: claim.tokenIv, tag: claim.tokenTag }),
    activatedAt: claim.activatedAt,
  };
}

/** Never let a raw Meta error (payload, token) reach the DB or the owner. */
function redactSyncError(error: unknown): string {
  if (error instanceof MetaApiError) {
    return `Meta respondió ${error.status}${error.code != null ? ` (código ${error.code})` : ""}`;
  }
  return "No se pudo contactar a Meta";
}

async function callSmbAppData(
  phoneNumberId: string,
  token: string,
  syncType: SyncType
): Promise<{ requestId: string } | { error: string }> {
  try {
    const res = await graphRequest<{ request_id?: string }>(`${phoneNumberId}/smb_app_data`, {
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", sync_type: syncType },
    });
    if (!res.request_id) return { error: "Meta no devolvió request_id" };
    return { requestId: res.request_id };
  } catch (error) {
    return { error: redactSyncError(error) };
  }
}

/**
 * Reclama la fila (INSERT … ON CONFLICT DO NOTHING sobre el UNIQUE) y, solo
 * si el reclamo tuvo éxito, llama a Meta. Una fila ya `requested`/`failed`
 * nunca vuelve a llamar a Meta desde aquí — Meta documenta cada paso como
 * "can only be performed once"; el reintento manual es `retrySync`.
 */
async function ensureRequested(
  organizationId: string,
  phoneNumberId: string,
  syncType: SyncType,
  token: string,
  windowExpiresAt: Date
): Promise<"requested" | "failed" | "skipped"> {
  const db = getDb();
  const inserted = await db
    .insert(schema.whatsappSmbSyncRequest)
    .values({
      id: newId("smbSyncRequest"),
      organizationId,
      phoneNumberId,
      syncType,
      status: "pending",
      windowExpiresAt,
    })
    .onConflictDoNothing({
      target: [
        schema.whatsappSmbSyncRequest.organizationId,
        schema.whatsappSmbSyncRequest.phoneNumberId,
        schema.whatsappSmbSyncRequest.syncType,
      ],
    })
    .returning();

  let row = inserted[0];
  if (!row) {
    const existing = await db
      .select()
      .from(schema.whatsappSmbSyncRequest)
      .where(
        and(
          eq(schema.whatsappSmbSyncRequest.organizationId, organizationId),
          eq(schema.whatsappSmbSyncRequest.phoneNumberId, phoneNumberId),
          eq(schema.whatsappSmbSyncRequest.syncType, syncType)
        )
      )
      .limit(1);
    row = existing[0];
    if (!row) return "skipped";
    if (row.status === "requested") return "requested";
    return row.status === "failed" ? "failed" : "skipped";
  }

  const result = await callSmbAppData(phoneNumberId, token, syncType);
  if ("error" in result) {
    await db
      .update(schema.whatsappSmbSyncRequest)
      .set({ status: "failed", error: result.error, updatedAt: new Date() })
      .where(eq(schema.whatsappSmbSyncRequest.id, row.id));
    return "failed";
  }
  await db
    .update(schema.whatsappSmbSyncRequest)
    .set({ status: "requested", requestId: result.requestId, error: null, updatedAt: new Date() })
    .where(eq(schema.whatsappSmbSyncRequest.id, row.id));
  return "requested";
}

/**
 * FR-043/044 — Pide contactos e historial UNA sola vez, en ese orden, al
 * activarse el claim. `history` solo se pide si `smb_app_state_sync` quedó
 * `requested`. Se llama SIEMPRE después del commit que activa el claim,
 * nunca dentro de una transacción.
 */
export async function requestInitialSync(organizationId: string): Promise<void> {
  const claim = await activeClaimToken(organizationId);
  if (!claim) return;
  const windowExpiresAt = new Date(claim.activatedAt.getTime() + SYNC_WINDOW_MS);

  const contacts = await ensureRequested(
    organizationId,
    claim.phoneNumberId,
    "smb_app_state_sync",
    claim.token,
    windowExpiresAt
  );
  if (contacts !== "requested") return;

  await ensureRequested(organizationId, claim.phoneNumberId, "history", claim.token, windowExpiresAt);
}

export type RetrySyncOutcome = "retried" | "not_found" | "window_expired" | "not_failed";

/**
 * Reintento manual del owner: solo aplica a filas `failed` con
 * `window_expires_at > now()`. `UPDATE … WHERE status = 'failed'` condicional
 * — dos clics no duplican la llamada a Meta.
 */
export async function retrySync(organizationId: string, syncType: SyncType): Promise<RetrySyncOutcome> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.whatsappSmbSyncRequest)
    .where(
      and(
        eq(schema.whatsappSmbSyncRequest.organizationId, organizationId),
        eq(schema.whatsappSmbSyncRequest.syncType, syncType)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return "not_found";
  if (row.windowExpiresAt.getTime() <= Date.now()) return "window_expired";
  if (row.status !== "failed") return "not_failed";

  const claim = await activeClaimToken(organizationId);
  if (!claim) return "not_found";

  const claimed = await db
    .update(schema.whatsappSmbSyncRequest)
    .set({ status: "pending", updatedAt: new Date() })
    .where(
      and(
        eq(schema.whatsappSmbSyncRequest.id, row.id),
        eq(schema.whatsappSmbSyncRequest.status, "failed")
      )
    )
    .returning();
  if (!claimed[0]) return "not_failed"; // otro reintento ya lo tomó (dos clics)

  const result = await callSmbAppData(claim.phoneNumberId, claim.token, syncType);
  if ("error" in result) {
    await db
      .update(schema.whatsappSmbSyncRequest)
      .set({ status: "failed", error: result.error, updatedAt: new Date() })
      .where(eq(schema.whatsappSmbSyncRequest.id, row.id));
    return "retried";
  }
  await db
    .update(schema.whatsappSmbSyncRequest)
    .set({ status: "requested", requestId: result.requestId, error: null, updatedAt: new Date() })
    .where(eq(schema.whatsappSmbSyncRequest.id, row.id));
  return "retried";
}

/**
 * Upsert de la libreta (`smb_app_state_sync`, acción `add`/`edit`): nunca
 * pisa un nombre `manual`; el de `libreta` sí puede refrescarse a sí mismo.
 * `remove` no tiene efecto sobre el contacto (E2) — solo se loguea.
 */
async function upsertLibretaContact(
  organizationId: string,
  phone: string,
  name: string | null
): Promise<void> {
  const db = getDb();
  const existing = await findWhatsappContact(organizationId, {
    identity: phone,
    phone,
    waUserId: null,
    profileName: null,
  });
  if (existing) {
    if (existing.nameSource === "manual") {
      if (existing.archivedAt) {
        await db
          .update(schema.contact)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(eq(schema.contact.id, existing.id));
      }
      return;
    }
    const patch: Partial<typeof schema.contact.$inferInsert> = {};
    if (name && name !== existing.name) patch.name = name;
    if (existing.nameSource !== "libreta") patch.nameSource = "libreta";
    if (existing.archivedAt) patch.archivedAt = null;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = new Date();
      await db.update(schema.contact).set(patch).where(eq(schema.contact.id, existing.id));
    }
    return;
  }

  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      waIdentity: phone,
      phone,
      waUserId: null,
      name: name || phone,
      nameSource: "libreta",
    })
    .onConflictDoNothing({
      target: [schema.contact.organizationId, schema.contact.channel, schema.contact.waIdentity],
    })
    .returning();
  if (!inserted[0]) {
    // Carrera: otro request lo creó entre el SELECT y el INSERT.
    await upsertLibretaContact(organizationId, phone, name);
  }
}

/** Applies a decoded `smb_app_state_sync` delivery (E2/E3, contracts/webhook-smb.md). */
export async function applyStateSync(organizationId: string, decoded: StateSyncDecision): Promise<void> {
  let received = 0;
  for (const op of decoded.contacts) {
    if (!op.phoneNumber) {
      console.warn(`[smb-sync] entrada de libreta sin teléfono (org ${organizationId}): ignorada`);
      continue;
    }
    if (op.action === "remove") {
      console.log(`[smb-sync] libreta: remove sin efecto sobre el contacto (org ${organizationId})`);
      continue;
    }
    const phone = normalizeMx(op.phoneNumber);
    const name = op.fullName?.trim() || op.firstName?.trim() || null;
    await upsertLibretaContact(organizationId, phone, name);
    received++;
  }
  if (received > 0) {
    await getDb()
      .update(schema.whatsappSmbSyncRequest)
      .set({
        itemsReceived: sql`${schema.whatsappSmbSyncRequest.itemsReceived} + ${received}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.whatsappSmbSyncRequest.organizationId, organizationId),
          eq(schema.whatsappSmbSyncRequest.phoneNumberId, decoded.phoneNumberId),
          eq(schema.whatsappSmbSyncRequest.syncType, "smb_app_state_sync")
        )
      );
  }
}

/** `history[].metadata.progress` (0–100), guardado en la petición `history`. */
export async function recordHistoryProgress(
  organizationId: string,
  phoneNumberId: string,
  progress: number
): Promise<void> {
  await getDb()
    .update(schema.whatsappSmbSyncRequest)
    .set({ progress: Math.max(0, Math.min(100, Math.round(progress))), updatedAt: new Date() })
    .where(
      and(
        eq(schema.whatsappSmbSyncRequest.organizationId, organizationId),
        eq(schema.whatsappSmbSyncRequest.phoneNumberId, phoneNumberId),
        eq(schema.whatsappSmbSyncRequest.syncType, "history")
      )
    );
}

/** Declinado por el negocio (código 2593109): no se reintenta. */
export async function markHistoryDeclined(organizationId: string, phoneNumberId: string): Promise<void> {
  await getDb()
    .update(schema.whatsappSmbSyncRequest)
    .set({ status: "declined", updatedAt: new Date() })
    .where(
      and(
        eq(schema.whatsappSmbSyncRequest.organizationId, organizationId),
        eq(schema.whatsappSmbSyncRequest.phoneNumberId, phoneNumberId),
        eq(schema.whatsappSmbSyncRequest.syncType, "history")
      )
    );
}

export type SyncRequestView = {
  status: "pending" | "requested" | "failed" | "declined" | "expired";
  progress: number | null;
  windowExpiresAt: string;
  error: string | null;
};

/** Vista para Ajustes → WhatsApp: `expired` se calcula, nunca se lee crudo. */
export async function getSyncStatus(
  organizationId: string
): Promise<{ contacts: SyncRequestView | null; history: SyncRequestView | null }> {
  const rows = await getDb()
    .select()
    .from(schema.whatsappSmbSyncRequest)
    .where(eq(schema.whatsappSmbSyncRequest.organizationId, organizationId));
  const now = Date.now();
  const toView = (
    row: typeof schema.whatsappSmbSyncRequest.$inferSelect | undefined
  ): SyncRequestView | null => {
    if (!row) return null;
    const expired =
      row.windowExpiresAt.getTime() <= now && (row.status === "pending" || row.status === "failed");
    return {
      status: expired ? "expired" : row.status,
      progress: row.progress,
      windowExpiresAt: row.windowExpiresAt.toISOString(),
      error: row.error,
    };
  };
  return {
    contacts: toView(rows.find((r) => r.syncType === "smb_app_state_sync")),
    history: toView(rows.find((r) => r.syncType === "history")),
  };
}
