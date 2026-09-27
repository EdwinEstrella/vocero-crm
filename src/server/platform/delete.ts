import { rm } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { decryptSecret } from "@/lib/crypto";
import { graphRequest } from "@/lib/meta/client";
import { endAllImpersonationsForOrganization } from "@/server/platform/impersonation";
import { recordPlatformEvent } from "@/server/platform/audit";
import type { PlatformActor } from "@/server/platform/suspension";

/**
 * 020 (E8/FR-037) — Borrado irreversible de una organización. El nombre
 * exacto es la confirmación (US6-1); las 28 tablas de dominio cascadean solas
 * (R7 del plan, `onDelete: "cascade"`), así que la transacción solo necesita
 * borrar la fila de `organization` y a los usuarios cuya única membresía era
 * ella. Todo lo que habla con el exterior (archivos, Meta) corre DESPUÉS del
 * commit y es mejor esfuerzo.
 */

export type DeleteOrganizationResult =
  | { ok: true; metaUnsubscribe: "ok" | "failed" | "skipped" }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "invalid_confirm" };

type WabaCredentials = { wabaId: string; token: string } | null;

async function readWabaCredentials(organizationId: string): Promise<WabaCredentials> {
  const db = getDb();
  const direct = await db
    .select()
    .from(schema.metaCredentials)
    .where(eq(schema.metaCredentials.organizationId, organizationId))
    .limit(1);
  const creds = direct[0];
  if (creds) {
    return {
      wabaId: creds.wabaId,
      token: decryptSecret({
        cipher: creds.tokenCipher,
        iv: creds.tokenIv,
        tag: creds.tokenTag,
      }),
    };
  }

  const claims = await db
    .select()
    .from(schema.whatsappCoexistenceClaim)
    .where(
      and(
        eq(schema.whatsappCoexistenceClaim.organizationId, organizationId),
        eq(schema.whatsappCoexistenceClaim.status, "active")
      )
    )
    .limit(1);
  const claim = claims[0];
  if (!claim) return null;
  return {
    wabaId: claim.wabaId,
    token: decryptSecret({
      cipher: claim.tokenCipher,
      iv: claim.tokenIv,
      tag: claim.tokenTag,
    }),
  };
}

/** Mejor esfuerzo (E8/FR-037): un fallo de Meta no bloquea el borrado. */
async function tryMetaUnsubscribe(
  creds: WabaCredentials
): Promise<"ok" | "failed" | "skipped"> {
  if (!creds) return "skipped";
  try {
    await graphRequest(`${creds.wabaId}/subscribed_apps`, {
      method: "DELETE",
      token: creds.token,
    });
    return "ok";
  } catch (err) {
    console.warn(
      "[platform] no se pudo desuscribir la WABA al borrar la organización:",
      err instanceof Error ? err.message : err
    );
    return "failed";
  }
}

/** Mejor esfuerzo: los archivos ya no importan si la fila de BD no existe. */
async function removeMediaDir(organizationId: string): Promise<void> {
  const dir = path.join(getEnv().MEDIA_DIR, organizationId);
  await rm(dir, { recursive: true, force: true }).catch((err) => {
    console.warn(
      `[platform] no se pudo borrar ${dir}:`,
      err instanceof Error ? err.message : err
    );
  });
}

export async function deleteOrganization(
  organizationId: string,
  confirmName: string,
  actor: PlatformActor
): Promise<DeleteOrganizationResult> {
  const db = getDb();
  const orgRows = await db
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const org = orgRows[0];
  if (!org) return { ok: false, reason: "not_found" };
  if (org.name !== confirmName) return { ok: false, reason: "invalid_confirm" };

  // US6-6: cualquier suplantación activa sobre esta organización termina con
  // `org_borrada` ANTES de que su nombre desaparezca.
  await endAllImpersonationsForOrganization(organizationId, org.name, actor);

  // E8: se lee el WABA/token ANTES de borrar — después ya no hay de dónde
  // sacarlos.
  const wabaCreds = await readWabaCredentials(organizationId);

  // Usuarios cuya ÚNICA membresía era esta organización (E5: cada usuario
  // tiene una sola, así que en la práctica es "todos los miembros", pero se
  // verifica en vez de asumirlo).
  const memberRows = await db
    .select({ userId: schema.member.userId })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId));
  const candidateUserIds = memberRows.map((m) => m.userId);
  let soleUserIds: string[] = [];
  if (candidateUserIds.length > 0) {
    const counts = await db
      .select({
        userId: schema.member.userId,
        count: sql<number>`count(*)`,
      })
      .from(schema.member)
      .where(inArray(schema.member.userId, candidateUserIds))
      .groupBy(schema.member.userId);
    soleUserIds = counts
      .filter((c) => Number(c.count) === 1)
      .map((c) => c.userId);
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.organization).where(eq(schema.organization.id, organizationId));
    if (soleUserIds.length > 0) {
      await tx.delete(schema.user).where(inArray(schema.user.id, soleUserIds));
    }
  });

  // Fuera de la transacción y mejor esfuerzo (Constitución II/IV): archivos y
  // llamada a Meta.
  await removeMediaDir(organizationId);
  const metaUnsubscribe = await tryMetaUnsubscribe(wabaCreds);

  await recordPlatformEvent({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: "org_deleted",
    organizationId,
    organizationName: org.name,
    metadata: { metaUnsubscribe },
  });

  return { ok: true, metaUnsubscribe };
}
