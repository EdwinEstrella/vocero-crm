import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 020 (FR-032) — Auditoría de plataforma: quién (super-admin) hizo qué a qué
 * organización. No es una tabla de dominio (Complexity Tracking del plan):
 * sobrevive al borrado de la organización que audita, así que jamás filtra ni
 * escribe a través de `scoped()`.
 */

export type PlatformAuditAction =
  | "org_suspended"
  | "org_reactivated"
  | "org_deleted"
  | "impersonation_started"
  | "impersonation_ended";

export type PlatformAuditEventView = {
  id: string;
  action: PlatformAuditAction;
  actorEmail: string;
  organizationId: string;
  organizationName: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

const PAGE_SIZE = 50;

export async function recordPlatformEvent(input: {
  actorUserId: string;
  actorEmail: string;
  action: PlatformAuditAction;
  organizationId: string;
  organizationName: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  await db.insert(schema.platformAuditEvent).values({
    id: newId("platformAuditEvent"),
    actorUserId: input.actorUserId,
    actorEmail: input.actorEmail,
    action: input.action,
    organizationId: input.organizationId,
    organizationName: input.organizationName,
    metadata: input.metadata ?? null,
  });
}

export async function listPlatformEvents(opts: {
  organizationId?: string;
  page?: number;
}): Promise<{ events: PlatformAuditEventView[] }> {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const rows = await db
    .select()
    .from(schema.platformAuditEvent)
    .where(
      opts.organizationId
        ? and(eq(schema.platformAuditEvent.organizationId, opts.organizationId))
        : undefined
    )
    .orderBy(desc(schema.platformAuditEvent.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  return {
    events: rows.map((r) => ({
      id: r.id,
      action: r.action as PlatformAuditAction,
      actorEmail: r.actorEmail,
      organizationId: r.organizationId,
      organizationName: r.organizationName,
      metadata: (r.metadata as Record<string, unknown> | null) ?? {},
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
