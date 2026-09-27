import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 020 (E6/FR-031/FR-034/FR-035) — Suplantación de organización: vale solo con
 * la MISMA sesión del admin, sin fin y sin expirar; nunca dos activas del
 * mismo admin (la previa se cierra con `reemplazada`); nunca sobre una
 * organización con otro super-admin como miembro; y las rutas sensibles
 * (equipo, clave de API) responden `403 suplantacion_restringida` mientras
 * dura. Todo lo que cierra una fila queda auditado a nombre del admin.
 */

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb };
});

const { recordPlatformEvent } = vi.hoisted(() => ({ recordPlatformEvent: vi.fn() }));
vi.mock("@/server/platform/audit", () => ({ recordPlatformEvent }));

const { isPlatformAdmin } = vi.hoisted(() => ({
  isPlatformAdmin: vi.fn((_u: { email: string; emailVerified?: boolean }) => false),
}));
vi.mock("@/server/platform/admins", () => ({
  isPlatformAdmin,
  NotPlatformAdminError: class NotPlatformAdminError extends Error {},
  requirePlatformAdmin: async () => {
    throw new Error("no se usa en este archivo");
  },
}));

/** Un chain de Drizzle mínimo: `.where()` es awaitable directo O soporta
 *  `.limit()`; ambos consumen la MISMA cola de lecturas en orden. */
function fakeDb(readQueue: unknown[][] = []) {
  const sets: Record<string, unknown>[] = [];
  const inserted: Record<string, unknown>[] = [];

  function readTerminal() {
    return {
      then: (resolve: (v: unknown) => void) => resolve(readQueue.shift() ?? []),
      limit: () => Promise.resolve(readQueue.shift() ?? []),
    };
  }

  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => readTerminal();
  chain.update = () => chain;
  chain.set = (v: Record<string, unknown>) => {
    sets.push(v);
    return { where: () => Promise.resolve() };
  };
  chain.insert = () => chain;
  chain.values = (v: Record<string, unknown>) => {
    inserted.push(v);
    return Promise.resolve();
  };
  getDb.mockReturnValue(chain);
  return { sets, inserted };
}

const ADMIN = { userId: "usr_admin", email: "admin@vocero.com", sessionId: "ses_admin" };

beforeEach(() => {
  getDb.mockReset();
  recordPlatformEvent.mockReset();
  isPlatformAdmin.mockReset();
  isPlatformAdmin.mockReturnValue(false);
});

describe("resolveImpersonation — misma sesión o nada", () => {
  it("sin cookie → null, sin tocar la base", async () => {
    fakeDb([]);
    const { resolveImpersonation } = await import("@/server/platform/impersonation");
    await expect(
      resolveImpersonation({ userId: "usr_admin", email: "admin@vocero.com" }, "ses_admin", undefined)
    ).resolves.toBeNull();
  });

  it("cookie de OTRO admin → se ignora (null), no se cierra la fila de nadie", async () => {
    fakeDb([[{ id: "imp_1", adminUserId: "usr_otro", organizationId: "org_a", sessionId: "ses_admin", endedAt: null, expiresAt: new Date(Date.now() + 60_000) }]]);
    const { resolveImpersonation } = await import("@/server/platform/impersonation");
    const out = await resolveImpersonation(
      { userId: "usr_admin", email: "admin@vocero.com" },
      "ses_admin",
      "imp_1"
    );
    expect(out).toBeNull();
    expect(recordPlatformEvent).not.toHaveBeenCalled();
  });

  it("sesión de Better Auth distinta → se cierra con 'sesion_terminada' y null", async () => {
    fakeDb([
      [{ id: "imp_1", adminUserId: "usr_admin", organizationId: "org_a", sessionId: "ses_VIEJA", endedAt: null, expiresAt: new Date(Date.now() + 60_000) }],
      [{ name: "Negocio A" }], // lookup del nombre para auditar el cierre
    ]);
    const { resolveImpersonation } = await import("@/server/platform/impersonation");
    const out = await resolveImpersonation(
      { userId: "usr_admin", email: "admin@vocero.com" },
      "ses_admin",
      "imp_1"
    );
    expect(out).toBeNull();
    expect(recordPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "impersonation_ended",
        actorUserId: "usr_admin",
        metadata: { endedReason: "sesion_terminada" },
      })
    );
  });

  it("válida (misma sesión, sin fin, sin expirar) → la resuelve", async () => {
    fakeDb([
      [{ id: "imp_1", adminUserId: "usr_admin", organizationId: "org_a", sessionId: "ses_admin", endedAt: null, expiresAt: new Date(Date.now() + 60_000) }],
      [{ id: "org_a", name: "Negocio A", suspendedAt: null }],
    ]);
    const { resolveImpersonation } = await import("@/server/platform/impersonation");
    const out = await resolveImpersonation(
      { userId: "usr_admin", email: "admin@vocero.com" },
      "ses_admin",
      "imp_1"
    );
    expect(out).toEqual({
      id: "imp_1",
      organizationId: "org_a",
      organizationName: "Negocio A",
      suspended: false,
    });
    expect(recordPlatformEvent).not.toHaveBeenCalled();
  });
});

describe("resolveImpersonation — expiración", () => {
  it("60 minutos cumplidos → se cierra con 'expirada' y null", async () => {
    fakeDb([
      [{ id: "imp_1", adminUserId: "usr_admin", organizationId: "org_a", sessionId: "ses_admin", endedAt: null, expiresAt: new Date(Date.now() - 1_000) }],
      [{ name: "Negocio A" }],
    ]);
    const { resolveImpersonation } = await import("@/server/platform/impersonation");
    const out = await resolveImpersonation(
      { userId: "usr_admin", email: "admin@vocero.com" },
      "ses_admin",
      "imp_1"
    );
    expect(out).toBeNull();
    expect(recordPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { endedReason: "expirada" } })
    );
  });
});

describe("startImpersonation — objetivo protegido y reemplazo", () => {
  it("organización inexistente → not_found", async () => {
    fakeDb([[]]);
    const { startImpersonation } = await import("@/server/platform/impersonation");
    await expect(startImpersonation(ADMIN, "org_x")).resolves.toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("organización con un super-admin como miembro → protected_target", async () => {
    isPlatformAdmin.mockImplementation(
      (u: { email: string }) => u.email === "otroadmin@vocero.com"
    );
    fakeDb([
      [{ id: "org_a", name: "Negocio A" }],
      [{ email: "otroadmin@vocero.com", emailVerified: true }],
    ]);
    const { startImpersonation } = await import("@/server/platform/impersonation");
    await expect(startImpersonation(ADMIN, "org_a")).resolves.toEqual({
      ok: false,
      reason: "protected_target",
    });
  });

  it("una activa por admin: la anterior se cierra con 'reemplazada' antes de crear la nueva", async () => {
    isPlatformAdmin.mockReturnValue(false);
    const { inserted } = fakeDb([
      [{ id: "org_b", name: "Negocio B" }], // organización objetivo
      [], // sin miembros super-admin
      [{ id: "imp_previa", organizationId: "org_a" }], // suplantación previa activa
      [{ name: "Negocio A" }], // nombre de la org de la previa, para auditar su cierre
    ]);
    const { startImpersonation } = await import("@/server/platform/impersonation");
    const result = await startImpersonation(ADMIN, "org_b");

    expect(result.ok).toBe(true);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ adminUserId: "usr_admin", organizationId: "org_b" });

    // Dos eventos: el cierre de la previa (reemplazada) y el arranque de la
    // nueva — ambos atribuidos al admin, nunca a un owner.
    expect(recordPlatformEvent).toHaveBeenCalledTimes(2);
    expect(recordPlatformEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        action: "impersonation_ended",
        actorUserId: "usr_admin",
        actorEmail: "admin@vocero.com",
        organizationId: "org_a",
        metadata: { endedReason: "reemplazada" },
      })
    );
    expect(recordPlatformEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: "impersonation_started",
        actorUserId: "usr_admin",
        organizationId: "org_b",
      })
    );
  });
});

describe("endImpersonation / endAllImpersonationsForOrganization", () => {
  it("sin suplantación activa → no hace nada (idempotente)", async () => {
    fakeDb([[]]);
    const { endImpersonation } = await import("@/server/platform/impersonation");
    await endImpersonation(ADMIN, "salida");
    expect(recordPlatformEvent).not.toHaveBeenCalled();
  });

  it("'Salir' cierra la activa y audita 'salida' a nombre del admin", async () => {
    fakeDb([
      [{ id: "imp_1", organizationId: "org_a" }],
      [{ name: "Negocio A" }],
    ]);
    const { endImpersonation } = await import("@/server/platform/impersonation");
    await endImpersonation(ADMIN, "salida");
    expect(recordPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "impersonation_ended",
        actorUserId: "usr_admin",
        metadata: { endedReason: "salida" },
      })
    );
  });

  it("borrar la organización cierra TODAS sus suplantaciones activas con 'org_borrada', sin buscar el nombre (ya se dio)", async () => {
    const { sets } = fakeDb([
      [
        { id: "imp_1", organizationId: "org_a" },
        { id: "imp_2", organizationId: "org_a" },
      ],
    ]);
    const { endAllImpersonationsForOrganization } = await import(
      "@/server/platform/impersonation"
    );
    await endAllImpersonationsForOrganization("org_a", "Negocio A (borrada)", ADMIN);
    expect(sets).toHaveLength(2);
    expect(recordPlatformEvent).toHaveBeenCalledTimes(2);
    expect(recordPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationName: "Negocio A (borrada)",
        metadata: { endedReason: "org_borrada" },
      })
    );
  });
});

describe("restricciones durante la suplantación (equipo y clave de API)", () => {
  const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
  vi.mock("@/lib/auth/session", () => ({
    requireSession,
    UnauthorizedError: class UnauthorizedError extends Error {},
    SuspendedOrganizationError: class SuspendedOrganizationError extends Error {},
  }));

  const impersonating = {
    userId: "usr_admin",
    organizationId: "org_a",
    role: "owner",
    impersonation: { id: "imp_1", organizationName: "Negocio A", suspended: false },
  };

  it("POST /api/settings/team suplantando → 403 suplantacion_restringida", async () => {
    requireSession.mockResolvedValue(impersonating);
    const { POST } = await import("@/app/api/settings/team/route");
    const res = await POST(
      new Request("http://localhost/api/settings/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", email: "x@x.com", password: "12345678" }),
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("suplantacion_restringida");
  });

  it("POST /api/settings/api-key suplantando → 403 suplantacion_restringida", async () => {
    requireSession.mockResolvedValue(impersonating);
    const { POST } = await import("@/app/api/settings/api-key/route");
    const res = await POST();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("suplantacion_restringida");
  });

  it("DELETE /api/settings/api-key suplantando → 403 suplantacion_restringida", async () => {
    requireSession.mockResolvedValue(impersonating);
    const { DELETE } = await import("@/app/api/settings/api-key/route");
    const res = await DELETE();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("suplantacion_restringida");
  });

  it("sin suplantación (owner normal) → NO se bloquea por este motivo", async () => {
    requireSession.mockResolvedValue({
      userId: "usr_owner",
      organizationId: "org_a",
      role: "member",
      impersonation: null,
    });
    const { POST } = await import("@/app/api/settings/team/route");
    const res = await POST(
      new Request("http://localhost/api/settings/team", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "X", email: "x@x.com", password: "12345678" }),
      })
    );
    // Sin suplantación, la regla que aplica es la de rol (no owner) — nunca
    // la de suplantación.
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("forbidden");
  });
});
