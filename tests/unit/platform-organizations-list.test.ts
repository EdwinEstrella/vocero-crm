import { describe, expect, it, vi } from "vitest";

/**
 * 020 (T030/FR-030) — Bug encontrado corriendo el arnés E2E contra Postgres
 * real (no mocks): `listOrganizations` asumía que `max(message.created_at)`
 * volvía como `Date` (el `sql<Date | null>\`...\`` de Drizzle es solo una
 * ANOTACIÓN de tipo — no convierte nada en runtime). El driver `postgres`
 * puede devolver el agregado como string, y `messages?.lastAt?.toISOString`
 * tronaba con `TypeError: ... is not a function`, tumbando TODO el panel
 * (`500 internal` en `/api/platform/organizations`).
 */

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb };
});
vi.mock("@/server/analytics/shared", () => ({ notLabContact: () => undefined }));

/** Cadena Drizzle genérica: cualquier método encadenable devuelve la misma
 *  cadena, y es "then-able" — resuelve con el siguiente resultado de la cola,
 *  en el mismo orden en que `listOrganizations` construye sus consultas. */
function fakeDb(resultsQueue: unknown[][]) {
  const queue = [...resultsQueue];
  function makeChain() {
    const chain: Record<string, unknown> = {};
    for (const m of ["from", "leftJoin", "innerJoin", "where", "orderBy", "limit", "offset", "groupBy"]) {
      chain[m] = () => chain;
    }
    chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(queue.shift() ?? []).then(resolve, reject);
    return chain;
  }
  return { select: () => makeChain() };
}

describe("listOrganizations — agregado de última actividad", () => {
  it("max(created_at) devuelto como STRING por el driver no rompe la lista", async () => {
    getDb.mockReturnValue(
      fakeDb([
        [
          {
            id: "org_1",
            name: "Negocio E2E",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            suspendedAt: null,
            ownerEmail: "owner@negocio.com",
          },
        ], // rows
        [{ count: 1 }], // totalRows
        [], // metaRows
        [], // attemptRows
        [{ organizationId: "org_1", count: 3 }], // contactRows
        // messageRows: `lastAt` como STRING, tal cual puede llegar del driver.
        [{ organizationId: "org_1", count: 7, lastAt: "2026-01-02T10:00:00.000Z" }],
      ])
    );

    const { listOrganizations } = await import("@/server/platform/organizations");
    const result = await listOrganizations({});

    expect(result.organizations).toHaveLength(1);
    expect(result.organizations[0]).toMatchObject({
      id: "org_1",
      messages: 7,
      lastActivityAt: "2026-01-02T10:00:00.000Z",
    });
  });

  it("sin mensajes → lastActivityAt null (no revienta con lastAt ausente)", async () => {
    getDb.mockReturnValue(
      fakeDb([
        [
          {
            id: "org_2",
            name: "Negocio sin mensajes",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            suspendedAt: null,
            ownerEmail: null,
          },
        ],
        [{ count: 1 }],
        [],
        [],
        [],
        [],
      ])
    );

    const { listOrganizations } = await import("@/server/platform/organizations");
    const result = await listOrganizations({});

    expect(result.organizations[0]).toMatchObject({
      messages: 0,
      lastActivityAt: null,
    });
  });
});
