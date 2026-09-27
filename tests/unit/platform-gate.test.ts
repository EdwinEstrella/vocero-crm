import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 020 (D4/FR-030) — El gate de super-admin: sesión + `email_verified = true` +
 * correo en `PLATFORM_ADMIN_EMAILS`. Cualquier otra combinación (sin sesión,
 * owner normal, correo listado pero sin verificar, correo verificado pero no
 * listado) debe comportarse como "no es admin" — la superficie responde 404
 * sin cuerpo (se prueba en `withPlatformAdmin`, no aquí).
 */

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  getAuth: () => ({ api: { getSession } }),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

beforeEach(() => {
  getSession.mockReset();
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com, otro@vocero.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("isPlatformAdmin", () => {
  it("correo verificado y listado → admin", async () => {
    const { isPlatformAdmin } = await import("@/server/platform/admins");
    expect(isPlatformAdmin({ email: "admin@vocero.com", emailVerified: true })).toBe(true);
  });

  it("correo listado pero SIN verificar → no admin", async () => {
    const { isPlatformAdmin } = await import("@/server/platform/admins");
    expect(isPlatformAdmin({ email: "admin@vocero.com", emailVerified: false })).toBe(false);
  });

  it("correo verificado pero NO listado (owner cualquiera) → no admin", async () => {
    const { isPlatformAdmin } = await import("@/server/platform/admins");
    expect(isPlatformAdmin({ email: "dueño@negocio.com", emailVerified: true })).toBe(false);
  });

  it("mayúsculas y espacios no importan", async () => {
    const { isPlatformAdmin } = await import("@/server/platform/admins");
    expect(isPlatformAdmin({ email: "  Admin@Vocero.com  ", emailVerified: true })).toBe(true);
  });
});

describe("requirePlatformAdmin", () => {
  it("sin sesión → NotPlatformAdminError", async () => {
    getSession.mockResolvedValue(null);
    const { requirePlatformAdmin, NotPlatformAdminError } = await import(
      "@/server/platform/admins"
    );
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(NotPlatformAdminError);
  });

  it("owner con sesión, correo no listado → NotPlatformAdminError", async () => {
    getSession.mockResolvedValue({
      session: { id: "ses_1" },
      user: { id: "usr_1", email: "dueño@negocio.com", emailVerified: true },
    });
    const { requirePlatformAdmin, NotPlatformAdminError } = await import(
      "@/server/platform/admins"
    );
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(NotPlatformAdminError);
  });

  it("correo listado pero sin verificar → NotPlatformAdminError", async () => {
    getSession.mockResolvedValue({
      session: { id: "ses_2" },
      user: { id: "usr_2", email: "admin@vocero.com", emailVerified: false },
    });
    const { requirePlatformAdmin, NotPlatformAdminError } = await import(
      "@/server/platform/admins"
    );
    await expect(requirePlatformAdmin()).rejects.toBeInstanceOf(NotPlatformAdminError);
  });

  it("correo listado y verificado → pasa, con el id de sesión de Better Auth", async () => {
    getSession.mockResolvedValue({
      session: { id: "ses_3" },
      user: { id: "usr_3", email: "Admin@Vocero.com", emailVerified: true },
    });
    const { requirePlatformAdmin } = await import("@/server/platform/admins");
    await expect(requirePlatformAdmin()).resolves.toEqual({
      userId: "usr_3",
      email: "Admin@Vocero.com",
      sessionId: "ses_3",
    });
  });
});
