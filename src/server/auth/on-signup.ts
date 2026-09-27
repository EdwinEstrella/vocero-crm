import { eq } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/** Etapas sembradas del pipeline (US2). */
const SEED_STAGES: { name: string; kind: "open" | "won" | "lost" }[] = [
  { name: "Nuevo", kind: "open" },
  { name: "En conversación", kind: "open" },
  { name: "Interesado", kind: "open" },
  { name: "Cliente", kind: "won" },
  { name: "Perdido", kind: "lost" },
];

const slugSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

/**
 * 020 — Plataforma multi-tenant: cada alta pública crea SU PROPIA
 * organización (D2). Un alta interna (`runInternalSignup`: cuenta de equipo o
 * script del super-admin) NO crea organización — se une a la del owner o no
 * pertenece a ninguna (super-admin, E4).
 *
 * Sin lock de "primer arranque": ya no hay una organización especial que
 * proteger, así que dos registros simultáneos simplemente crean dos
 * organizaciones distintas (FR-002).
 */
export async function onUserCreated(
  userId: string,
  userName: string,
  opts: { internal: boolean }
): Promise<void> {
  if (opts.internal) return;

  const db = getDb();
  await db.transaction(async (tx) => {
    const orgId = newId("organization");
    await tx.insert(schema.organization).values({
      id: orgId,
      name: userName ? `Negocio de ${userName}` : "Mi negocio",
      slug: `negocio-${slugSuffix()}`,
    });
    await tx.insert(schema.member).values({
      id: newId("member"),
      organizationId: orgId,
      userId,
      role: "owner",
    });
    await tx.insert(schema.pipelineStage).values(
      SEED_STAGES.map((s, i) => ({
        id: newId("stage"),
        organizationId: orgId,
        name: s.name,
        position: i,
        kind: s.kind,
      }))
    );
    await tx.insert(schema.agentProfile).values({
      id: newId("agentProfile"),
      organizationId: orgId,
    });
  });
}

/** Organización activa de un usuario (su única membresía, E5). */
export async function resolveActiveOrganizationId(
  userId: string
): Promise<string | null> {
  return (await resolveMembership(userId))?.organizationId ?? null;
}

export type Membership = {
  organizationId: string;
  role: string;
  /** 020 — la organización está suspendida (FR-005/006). */
  suspendedAt: Date | null;
};

/**
 * La membresía del usuario, con el estado de suspensión de SU organización
 * (E5: un usuario pertenece a exactamente una). Un super-admin (E4) no tiene
 * membresía y esta función devuelve null para él — su gate vive en
 * `src/server/platform/admins.ts`, no aquí.
 */
export async function resolveMembership(
  userId: string
): Promise<Membership | null> {
  const db = getDb();
  const rows = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      suspendedAt: schema.organization.suspendedAt,
    })
    .from(schema.member)
    .innerJoin(
      schema.organization,
      eq(schema.organization.id, schema.member.organizationId)
    )
    .where(eq(schema.member.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}
