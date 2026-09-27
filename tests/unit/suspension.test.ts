import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 020 (FR-005/006/036) — Una organización suspendida se rechaza en sus
 * puntos de entrada: `requireSession` (API/páginas), `requireBotKey` (el
 * cerebro externo) y el hook de login (cubierto aparte en
 * `tests/unit/session-hook.test.ts`, que necesita mockear `better-auth`
 * mismo y no puede compartir archivo con estos sin pisarse los mocks de
 * módulo). `suspendOrganization`/`reactivateOrganization` son idempotentes
 * (contrato plataforma.md).
 */

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb };
});

// ---------------------------------------------------------------------------
// 1) requireSession — 403 SuspendedOrganizationError para un miembro de una
//    organización suspendida.
// ---------------------------------------------------------------------------
describe("requireSession — organización suspendida", () => {
  const { getSession, resolveMembership, isPlatformAdmin } = vi.hoisted(() => ({
    getSession: vi.fn(),
    resolveMembership: vi.fn(),
    isPlatformAdmin: vi.fn(() => false),
  }));

  vi.mock("@/lib/auth", () => ({ getAuth: () => ({ api: { getSession } }) }));
  vi.mock("next/headers", () => ({
    headers: async () => new Headers(),
    cookies: async () => ({ get: () => undefined }),
  }));
  vi.mock("@/server/auth/on-signup", () => ({ resolveMembership }));
  vi.mock("@/server/platform/admins", () => ({ isPlatformAdmin }));
  vi.mock("@/server/platform/impersonation", () => ({
    IMPERSONATION_COOKIE: "vocero_imp",
    resolveImpersonation: async () => null,
  }));

  beforeEach(() => {
    getSession.mockReset();
    resolveMembership.mockReset();
    isPlatformAdmin.mockReturnValue(false);
  });

  it("miembro de organización suspendida → SuspendedOrganizationError", async () => {
    getSession.mockResolvedValue({
      session: { id: "ses_1" },
      user: { id: "usr_1", email: "dueño@negocio.com", emailVerified: false },
    });
    resolveMembership.mockResolvedValue({
      organizationId: "org_a",
      role: "owner",
      suspendedAt: new Date(),
    });
    const { requireSession, SuspendedOrganizationError } = await import(
      "@/lib/auth/session"
    );
    await expect(requireSession()).rejects.toBeInstanceOf(SuspendedOrganizationError);
  });

  it("miembro de organización activa → pasa normalmente", async () => {
    getSession.mockResolvedValue({
      session: { id: "ses_1" },
      user: { id: "usr_1", email: "dueño@negocio.com", emailVerified: false },
    });
    resolveMembership.mockResolvedValue({
      organizationId: "org_a",
      role: "owner",
      suspendedAt: null,
    });
    const { requireSession } = await import("@/lib/auth/session");
    await expect(requireSession()).resolves.toEqual({
      userId: "usr_1",
      organizationId: "org_a",
      role: "owner",
      impersonation: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 2) requireBotKey — 403 org_suspendida (el gate delega en
//    isOrganizationSuspended de suspension.ts, que usa @/lib/db).
// ---------------------------------------------------------------------------
describe("requireBotKey — organización suspendida", () => {
  const { resolveBotKey } = vi.hoisted(() => ({ resolveBotKey: vi.fn() }));

  vi.mock("@/server/bot/keys", () => ({
    resolveBotKey,
    touchBotKeyLastUsed: async () => {},
  }));

  function fakeSuspendedLookup(suspended: boolean) {
    getDb.mockReturnValue({
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ suspendedAt: suspended ? new Date() : null }],
          }),
        }),
      }),
    });
  }

  beforeEach(() => {
    getDb.mockReset();
    resolveBotKey.mockReset();
  });

  it("clave válida de una organización suspendida → 403 org_suspendida", async () => {
    resolveBotKey.mockResolvedValue({ organizationId: "org_a", keyId: "bak_a" });
    fakeSuspendedLookup(true);
    const { resetSuspensionCache } = await import("@/server/platform/suspension");
    resetSuspensionCache();
    const { requireBotKey } = await import("@/server/bot/auth");
    const res = await requireBotKey(
      new Request("http://localhost/api/bot/context", { headers: { "x-api-key": "vk_x" } })
    );
    expect(res instanceof Response && res.status).toBe(403);
    const body = res instanceof Response ? await res.json() : null;
    expect((body as { error?: { code?: string } } | null)?.error?.code).toBe(
      "org_suspendida"
    );
  });

  it("clave válida de una organización activa → pasa", async () => {
    resolveBotKey.mockResolvedValue({ organizationId: "org_b", keyId: "bak_b" });
    fakeSuspendedLookup(false);
    const { resetSuspensionCache } = await import("@/server/platform/suspension");
    resetSuspensionCache();
    const { requireBotKey } = await import("@/server/bot/auth");
    const res = await requireBotKey(
      new Request("http://localhost/api/bot/context", { headers: { "x-api-key": "vk_x" } })
    );
    expect(res instanceof Response).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3) suspendOrganization / reactivateOrganization — idempotencia.
// ---------------------------------------------------------------------------
describe("suspendOrganization / reactivateOrganization — idempotencia", () => {
  const { recordPlatformEvent } = vi.hoisted(() => ({ recordPlatformEvent: vi.fn() }));
  vi.mock("@/server/platform/audit", () => ({ recordPlatformEvent }));

  function fakeDb(orgQueue: unknown[][]) {
    const sets: Record<string, unknown>[] = [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => Promise.resolve(orgQueue.shift() ?? []);
    chain.update = () => chain;
    chain.set = (v: Record<string, unknown>) => {
      sets.push(v);
      return chain;
    };
    chain.delete = () => chain;
    chain.transaction = async (fn: (tx: typeof chain) => Promise<void>) => {
      await fn(chain);
    };
    getDb.mockReturnValue(chain);
    return { sets };
  }

  const actor = { userId: "usr_admin", email: "admin@vocero.com" };

  beforeEach(() => {
    getDb.mockReset();
    recordPlatformEvent.mockReset();
  });

  it("suspender dos veces: la segunda no cambia suspendedAt ni duplica la auditoría", async () => {
    const { suspendOrganization } = await import("@/server/platform/suspension");

    fakeDb([[{ id: "org_a", name: "Negocio A", suspendedAt: null }]]);
    const first = await suspendOrganization("org_a", undefined, actor);
    expect(first.suspendedAt).toBeInstanceOf(Date);
    expect(recordPlatformEvent).toHaveBeenCalledTimes(1);

    // La organización YA está suspendida (con la fecha que dejó la primera
    // llamada): la segunda debe devolver esa misma fecha sin tocarla.
    fakeDb([[{ id: "org_a", name: "Negocio A", suspendedAt: first.suspendedAt }]]);
    const second = await suspendOrganization("org_a", undefined, actor);
    expect(second.suspendedAt).toEqual(first.suspendedAt);
    // La segunda llamada no debe agregar un evento nuevo.
    expect(recordPlatformEvent).toHaveBeenCalledTimes(1);
  });

  it("reactivar una organización activa no hace nada (idempotente)", async () => {
    const { reactivateOrganization } = await import("@/server/platform/suspension");
    fakeDb([[{ id: "org_a", name: "Negocio A", suspendedAt: null }]]);
    await reactivateOrganization("org_a", actor);
    expect(recordPlatformEvent).not.toHaveBeenCalled();
  });

  it("reactivar una suspendida limpia suspendedAt y audita una vez", async () => {
    const { reactivateOrganization } = await import("@/server/platform/suspension");
    const { sets } = fakeDb([[{ id: "org_a", name: "Negocio A", suspendedAt: new Date() }]]);
    await reactivateOrganization("org_a", actor);
    expect(sets[0]).toEqual({ suspendedAt: null, suspendedReason: null });
    expect(recordPlatformEvent).toHaveBeenCalledTimes(1);
    expect(recordPlatformEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "org_reactivated", organizationId: "org_a" })
    );
  });
});
