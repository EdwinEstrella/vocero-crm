import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { notLabContact } from "@/server/analytics/shared";

/**
 * 020 (D3/FR-030) — Lista del panel de super-admin: nombre, correo del
 * owner, estado de WhatsApp/coexistence, conteos (sin Laboratorio) y última
 * actividad. Único módulo (junto con `admins`, `audit`, `impersonation`,
 * `suspension`, `delete`) que consulta entre tenants — exención constitucional
 * confinada a `src/server/platform/` y cubierta por el test estático
 * `no-single-org.test.ts`.
 *
 * Sin N+1: la página (50 filas) sale con un puñado de consultas acotadas
 * (nunca proporcional al número de filas), sin importar cuántas
 * organizaciones existan.
 */

const PAGE_SIZE = 50;

export type OrganizationWhatsappStatus = "connected" | "reconnect_required" | "none";
export type OrganizationCoexistenceStatus =
  | "pending"
  | "awaiting_confirmation"
  | "active"
  | "rejected"
  | "revoked"
  | "disconnected"
  | "none";

export type OrganizationListItem = {
  id: string;
  name: string;
  ownerEmail: string | null;
  createdAt: string;
  suspendedAt: string | null;
  whatsapp: OrganizationWhatsappStatus;
  coexistence: OrganizationCoexistenceStatus;
  contacts: number;
  messages: number;
  lastActivityAt: string | null;
};

export type OrganizationListResult = {
  page: number;
  pageSize: number;
  total: number;
  organizations: OrganizationListItem[];
};

export async function listOrganizations(opts: {
  q?: string;
  page?: number;
}): Promise<OrganizationListResult> {
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.q?.trim();

  const searchCondition = q
    ? or(
        ilike(schema.organization.name, `%${q}%`),
        ilike(schema.user.email, `%${q}%`)
      )
    : undefined;

  const rows = await db
    .select({
      id: schema.organization.id,
      name: schema.organization.name,
      createdAt: schema.organization.createdAt,
      suspendedAt: schema.organization.suspendedAt,
      ownerEmail: schema.user.email,
    })
    .from(schema.organization)
    .leftJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.organization.id),
        eq(schema.member.role, "owner")
      )
    )
    .leftJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(searchCondition)
    .orderBy(desc(schema.organization.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.organization)
    .leftJoin(
      schema.member,
      and(
        eq(schema.member.organizationId, schema.organization.id),
        eq(schema.member.role, "owner")
      )
    )
    .leftJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(searchCondition);
  const total = Number(totalRows[0]?.count ?? 0);

  if (rows.length === 0) {
    return { page, pageSize: PAGE_SIZE, total, organizations: [] };
  }

  const orgIds = rows.map((r) => r.id);

  const [metaRows, attemptRows, contactRows, messageRows] = await Promise.all([
    db
      .select({
        organizationId: schema.metaCredentials.organizationId,
        status: schema.metaCredentials.status,
      })
      .from(schema.metaCredentials)
      .where(inArray(schema.metaCredentials.organizationId, orgIds)),
    db
      .select({
        organizationId: schema.whatsappCoexistenceAttempt.organizationId,
        status: schema.whatsappCoexistenceAttempt.status,
        createdAt: schema.whatsappCoexistenceAttempt.createdAt,
      })
      .from(schema.whatsappCoexistenceAttempt)
      .where(inArray(schema.whatsappCoexistenceAttempt.organizationId, orgIds))
      .orderBy(desc(schema.whatsappCoexistenceAttempt.createdAt)),
    db
      .select({
        organizationId: schema.contact.organizationId,
        count: sql<number>`count(*)`,
      })
      .from(schema.contact)
      .where(
        and(
          inArray(schema.contact.organizationId, orgIds),
          notLabContact(schema.contact.id)
        )
      )
      .groupBy(schema.contact.organizationId),
    db
      .select({
        organizationId: schema.message.organizationId,
        count: sql<number>`count(*)`,
        lastAt: sql<Date | null>`max(${schema.message.createdAt})`,
      })
      .from(schema.message)
      .innerJoin(
        schema.conversation,
        eq(schema.conversation.id, schema.message.conversationId)
      )
      .where(
        and(
          inArray(schema.message.organizationId, orgIds),
          eq(schema.conversation.isTest, false)
        )
      )
      .groupBy(schema.message.organizationId),
  ]);

  const whatsappByOrg = new Map<string, OrganizationWhatsappStatus>(
    metaRows.map((r) => [r.organizationId, r.status as OrganizationWhatsappStatus])
  );
  const coexistenceByOrg = new Map<string, OrganizationCoexistenceStatus>();
  for (const attempt of attemptRows) {
    // Las filas llegan ordenadas por created_at desc: la primera que se ve
    // por organización es la más reciente.
    if (!coexistenceByOrg.has(attempt.organizationId)) {
      coexistenceByOrg.set(
        attempt.organizationId,
        attempt.status as OrganizationCoexistenceStatus
      );
    }
  }
  const contactsByOrg = new Map<string, number>(
    contactRows.map((r) => [r.organizationId, Number(r.count)])
  );
  const messagesByOrg = new Map<string, { count: number; lastAt: Date | null }>(
    messageRows.map((r) => [r.organizationId, { count: Number(r.count), lastAt: r.lastAt }])
  );

  return {
    page,
    pageSize: PAGE_SIZE,
    total,
    organizations: rows.map((r) => {
      const messages = messagesByOrg.get(r.id);
      return {
        id: r.id,
        name: r.name,
        ownerEmail: r.ownerEmail ?? null,
        createdAt: r.createdAt.toISOString(),
        suspendedAt: r.suspendedAt?.toISOString() ?? null,
        whatsapp: whatsappByOrg.get(r.id) ?? "none",
        coexistence: coexistenceByOrg.get(r.id) ?? "none",
        contacts: contactsByOrg.get(r.id) ?? 0,
        messages: messages?.count ?? 0,
        // `max(message.created_at)` viaja detrás de un `sql<Date | null>` que
        // es solo una anotación de tipo: el driver de postgres puede devolver
        // el agregado como string en vez de Date (a diferencia de una columna
        // seleccionada directa), así que se normaliza antes de serializar.
        lastActivityAt: messages?.lastAt ? new Date(messages.lastAt).toISOString() : null,
      };
    }),
  };
}
