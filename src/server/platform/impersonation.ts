import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { isPlatformAdmin } from "@/server/platform/admins";
import { recordPlatformEvent } from "@/server/platform/audit";

/**
 * 020 (E6/FR-031, FR-035) — Suplantación de ORGANIZACIÓN (no de usuario, R5
 * del plan): una fila que ata la sesión de soporte a la sesión de Better Auth
 * del admin, y una cookie httpOnly que solo la referencia. Vale SOLO junto
 * con esa misma sesión, sin fin y sin expirar (60 min).
 */

export const IMPERSONATION_COOKIE = "vocero_imp";
const DURATION_MS = 60 * 60 * 1000;

export type EndedReason =
  | "salida"
  | "expirada"
  | "sesion_terminada"
  | "reemplazada"
  | "org_borrada";

export type ResolvedImpersonation = {
  id: string;
  organizationId: string;
  organizationName: string;
  suspended: boolean;
};

/** Cierra la fila activa (si la hay) y audita el fin. Comparte lógica entre
 *  el arranque de una nueva suplantación, "Salir", la expiración detectada al
 *  resolver la cookie y el borrado de la organización. */
async function closeImpersonationRow(
  db: ReturnType<typeof getDb>,
  row: { id: string; organizationId: string },
  reason: EndedReason,
  actor: { userId: string; email: string },
  organizationNameOverride?: string
): Promise<void> {
  await db
    .update(schema.platformImpersonation)
    .set({ endedAt: new Date(), endedReason: reason })
    .where(eq(schema.platformImpersonation.id, row.id));

  let organizationName = organizationNameOverride;
  if (!organizationName) {
    const orgRows = await db
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, row.organizationId))
      .limit(1);
    organizationName = orgRows[0]?.name ?? row.organizationId;
  }

  await recordPlatformEvent({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: "impersonation_ended",
    organizationId: row.organizationId,
    organizationName,
    metadata: { endedReason: reason },
  });
}

export type StartImpersonationResult =
  | { ok: true; id: string; organizationName: string; expiresAt: Date }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "protected_target" };

/**
 * Cierra la suplantación activa previa del mismo admin (FR-035: nunca dos a
 * la vez) y crea la nueva. Rechaza un objetivo con un miembro super-admin
 * (E6): entrar como soporte a la organización de OTRO operador no es soporte.
 */
export async function startImpersonation(
  admin: { userId: string; email: string; sessionId: string },
  organizationId: string
): Promise<StartImpersonationResult> {
  const db = getDb();

  const orgRows = await db
    .select({ id: schema.organization.id, name: schema.organization.name })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const org = orgRows[0];
  if (!org) return { ok: false, reason: "not_found" };

  const members = await db
    .select({ email: schema.user.email, emailVerified: schema.user.emailVerified })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, organizationId));
  if (members.some((m) => isPlatformAdmin(m))) {
    return { ok: false, reason: "protected_target" };
  }

  const id = newId("impersonation");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DURATION_MS);

  // FR-035: a lo mucho una activa por admin — se cierra la previa (si la
  // hay) ANTES de crear la nueva; el índice parcial UNIQUE de la tabla es la
  // última línea de defensa si dos requests del mismo admin se cruzan.
  const active = await db
    .select({
      id: schema.platformImpersonation.id,
      organizationId: schema.platformImpersonation.organizationId,
    })
    .from(schema.platformImpersonation)
    .where(
      and(
        eq(schema.platformImpersonation.adminUserId, admin.userId),
        isNull(schema.platformImpersonation.endedAt)
      )
    )
    .limit(1);
  if (active[0]) {
    await closeImpersonationRow(db, active[0], "reemplazada", admin);
  }
  await db.insert(schema.platformImpersonation).values({
    id,
    adminUserId: admin.userId,
    organizationId,
    sessionId: admin.sessionId,
    startedAt: now,
    expiresAt,
  });

  await recordPlatformEvent({
    actorUserId: admin.userId,
    actorEmail: admin.email,
    action: "impersonation_started",
    organizationId,
    organizationName: org.name,
  });

  return { ok: true, id, organizationName: org.name, expiresAt };
}

/** "Salir": cierra la suplantación activa del admin. Idempotente. */
export async function endImpersonation(
  admin: { userId: string; email: string },
  reason: EndedReason = "salida"
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.platformImpersonation)
    .where(
      and(
        eq(schema.platformImpersonation.adminUserId, admin.userId),
        isNull(schema.platformImpersonation.endedAt)
      )
    )
    .limit(1);
  const row = rows[0];
  if (!row) return;
  await closeImpersonationRow(db, row, reason, admin);
}

/**
 * Cierra TODAS las suplantaciones activas de una organización con motivo
 * `org_borrada` (US6-6). Se llama ANTES de borrar la organización, con su
 * nombre ya leído (la fila `organization` desaparece dentro de la misma
 * operación de borrado).
 */
export async function endAllImpersonationsForOrganization(
  organizationId: string,
  organizationName: string,
  actor: { userId: string; email: string }
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.platformImpersonation)
    .where(
      and(
        eq(schema.platformImpersonation.organizationId, organizationId),
        isNull(schema.platformImpersonation.endedAt)
      )
    );
  for (const row of rows) {
    await closeImpersonationRow(db, row, "org_borrada", actor, organizationName);
  }
}

/**
 * Resuelve la cookie `vocero_imp` a una suplantación válida: misma fila, del
 * MISMO admin, de la MISMA sesión de Better Auth, sin fin y sin expirar. Una
 * cookie inválida se ignora; si la fila seguía abierta, se cierra con el
 * motivo que corresponda (contrato plataforma.md).
 */
export async function resolveImpersonation(
  admin: { userId: string; email: string },
  sessionId: string,
  cookieId: string | undefined
): Promise<ResolvedImpersonation | null> {
  if (!cookieId) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.platformImpersonation)
    .where(eq(schema.platformImpersonation.id, cookieId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.adminUserId !== admin.userId) return null;
  if (row.endedAt) return null;

  if (row.sessionId !== sessionId) {
    await closeImpersonationRow(db, row, "sesion_terminada", admin);
    return null;
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    await closeImpersonationRow(db, row, "expirada", admin);
    return null;
  }

  const orgRows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      suspendedAt: schema.organization.suspendedAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, row.organizationId))
    .limit(1);
  const org = orgRows[0];
  if (!org) return null;

  return {
    id: row.id,
    organizationId: org.id,
    organizationName: org.name,
    suspended: org.suspendedAt != null,
  };
}
