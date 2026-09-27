import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 020 (FR-006) — El hook de login (`databaseHooks.session.create.before` en
 * `src/lib/auth/index.ts`) rechaza la creación de sesión de un usuario cuya
 * organización está suspendida, con el mensaje exacto de la spec.
 *
 * Se prueba capturando la config REAL que `createAuth()` armaría, mockeando
 * `betterAuth` como identidad (devuelve su argumento tal cual) en vez de
 * construir el runtime completo de Better Auth — así se ejecuta el hook de
 * verdad sin abrir una base de datos.
 *
 * Archivo separado a propósito: mockea `better-auth` y `@/server/auth/
 * on-signup` de una forma que pisaría los mocks de otros tests de sesión si
 * compartiera archivo con ellos (los `vi.mock` de Vitest se izan por
 * archivo).
 */

const { resolveMembership } = vi.hoisted(() => ({ resolveMembership: vi.fn() }));

vi.mock("better-auth", () => ({
  betterAuth: (config: unknown) => config,
}));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: () => ({}),
}));
vi.mock("better-auth/plugins", () => ({ organization: () => ({}) }));
vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    status: string;
    constructor(status: string, opts: { message: string }) {
      super(opts.message);
      this.status = status;
    }
  },
  createAuthMiddleware: (fn: unknown) => fn,
}));
vi.mock("@/lib/db", () => ({ getDb: () => ({}), schema: {} }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    APP_BASE_URL: "http://localhost:3000",
    BETTER_AUTH_SECRET: "x".repeat(20),
  }),
}));
vi.mock("@/lib/rate-limit", () => ({
  AUTH_RATE_LIMIT: { windowMs: 1, max: 1 },
  checkRateLimit: () => ({ allowed: true }),
  clientIp: () => "127.0.0.1",
}));
vi.mock("@/server/auth/on-signup", () => ({
  onUserCreated: async () => {},
  resolveMembership,
}));
vi.mock("@/server/auth/registration", () => ({
  isReservedPlatformEmail: () => false,
}));

beforeEach(() => {
  vi.resetModules();
  resolveMembership.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("hook de sesión (login) — organización suspendida", () => {
  it("organización suspendida → rechaza la sesión con el mensaje de la spec", async () => {
    resolveMembership.mockResolvedValue({
      organizationId: "org_a",
      role: "owner",
      suspendedAt: new Date("2026-09-27T00:00:00Z"),
    });
    const { getAuth } = await import("@/lib/auth");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = getAuth() as any;
    await expect(
      auth.databaseHooks.session.create.before({ userId: "usr_1" })
    ).rejects.toThrow("Tu cuenta está suspendida; contacta a soporte");
  });

  it("organización activa → deja pasar y fija activeOrganizationId", async () => {
    resolveMembership.mockResolvedValue({
      organizationId: "org_a",
      role: "owner",
      suspendedAt: null,
    });
    const { getAuth } = await import("@/lib/auth");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = getAuth() as any;
    const result = await auth.databaseHooks.session.create.before({ userId: "usr_1" });
    expect(result.data.activeOrganizationId).toBe("org_a");
  });

  it("sin membresía (super-admin, o alta a mitad de transacción) → deja pasar sin organización", async () => {
    resolveMembership.mockResolvedValue(null);
    const { getAuth } = await import("@/lib/auth");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = getAuth() as any;
    const result = await auth.databaseHooks.session.create.before({ userId: "usr_admin" });
    expect(result.data.activeOrganizationId).toBeNull();
  });
});
