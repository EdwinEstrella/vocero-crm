import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { recordPlatformEvent } from "@/server/platform/audit";

/**
 * 020 (FR-036, D3) — Suspender/reactivar y el único punto que responde
 * "¿está suspendida esta organización?" para el resto del código
 * (`requireBotKey`, webhook, pipeline…). `isOrganizationSuspended` cachea 30s
 * por organización — el gate en cada request de `/api/bot/*` no puede costar
 * una consulta por turno, y 30s es lo bastante corto para que suspender surta
 * efecto casi de inmediato.
 */

export class OrganizationNotFoundError extends Error {
  constructor(message = "La organización no existe") {
    super(message);
    this.name = "OrganizationNotFoundError";
  }
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { suspended: boolean; expiresAt: number }>();

export async function isOrganizationSuspended(
  organizationId: string
): Promise<boolean> {
  const now = Date.now();
  const cached = cache.get(organizationId);
  if (cached && cached.expiresAt > now) return cached.suspended;

  const db = getDb();
  const rows = await db
    .select({ suspendedAt: schema.organization.suspendedAt })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const suspended = rows[0]?.suspendedAt != null;
  cache.set(organizationId, { suspended, expiresAt: now + CACHE_TTL_MS });
  return suspended;
}

function invalidateSuspensionCache(organizationId: string): void {
  cache.delete(organizationId);
}

/** Solo para tests. */
export function resetSuspensionCache(): void {
  cache.clear();
}

export type PlatformActor = { userId: string; email: string };

/**
 * Fija `suspended_at`, revoca las sesiones de sus miembros y audita.
 * Idempotente: suspender una organización ya suspendida no cambia
 * `suspendedAt` ni duplica el evento de auditoría (contrato plataforma.md).
 */
export async function suspendOrganization(
  organizationId: string,
  reason: string | undefined,
  actor: PlatformActor
): Promise<{ suspendedAt: Date }> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      suspendedAt: schema.organization.suspendedAt,
    })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const org = rows[0];
  if (!org) throw new OrganizationNotFoundError();
  if (org.suspendedAt) {
    // Ya suspendida: no se toca la fecha ni se repite el evento.
    return { suspendedAt: org.suspendedAt };
  }

  const suspendedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.organization)
      .set({ suspendedAt, suspendedReason: reason ?? null })
      .where(eq(schema.organization.id, organizationId));

    const members = await tx
      .select({ userId: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, organizationId));
    if (members.length > 0) {
      await tx
        .delete(schema.session)
        .where(inArray(schema.session.userId, members.map((m) => m.userId)));
    }
  });
  invalidateSuspensionCache(organizationId);

  await recordPlatformEvent({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: "org_suspended",
    organizationId,
    organizationName: org.name,
    metadata: reason ? { reason } : undefined,
  });

  return { suspendedAt };
}

/** Idempotente: reactivar una organización activa no hace nada. */
export async function reactivateOrganization(
  organizationId: string,
  actor: PlatformActor
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.organization.id, name: schema.organization.name, suspendedAt: schema.organization.suspendedAt })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  const org = rows[0];
  if (!org) throw new OrganizationNotFoundError();
  if (!org.suspendedAt) return;

  await db
    .update(schema.organization)
    .set({ suspendedAt: null, suspendedReason: null })
    .where(eq(schema.organization.id, organizationId));
  invalidateSuspensionCache(organizationId);

  await recordPlatformEvent({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: "org_reactivated",
    organizationId,
    organizationName: org.name,
  });
}
