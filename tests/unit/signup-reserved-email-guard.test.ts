import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 020 (FR-004) — Seguridad: el correo reservado para el super-admin
 * (`PLATFORM_ADMIN_EMAILS`) se rechaza en CUALQUIER `/sign-up/email`, público
 * o interno (`runInternalSignup`, usado por `POST /api/settings/team`). Antes
 * la condición `!isInternalSignup()` dejaba pasar el alta de equipo: un owner
 * podía apropiarse del correo reservado y bloquear a
 * `scripts/platform-admin.mjs` ("ya pertenece a una organización").
 */

afterEach(() => vi.unstubAllEnvs());

describe("assertSignUpEmailAllowed", () => {
  it("correo reservado en un alta pública → lanza (correo_reservado)", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    const { assertSignUpEmailAllowed } = await import("@/lib/auth");
    expect(() =>
      assertSignUpEmailAllowed("/sign-up/email", { email: "admin@vocero.com" })
    ).toThrow();
  });

  it("correo reservado con mayúsculas y espacios de sobra → igual se rechaza", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    const { assertSignUpEmailAllowed } = await import("@/lib/auth");
    expect(() =>
      assertSignUpEmailAllowed("/sign-up/email", { email: "  Admin@Vocero.com  " })
    ).toThrow();
  });

  it("dentro de runInternalSignup (alta de equipo) el correo reservado SIGUE rechazado", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    const { assertSignUpEmailAllowed, runInternalSignup } = await import("@/lib/auth");
    await expect(
      runInternalSignup(async () => {
        assertSignUpEmailAllowed("/sign-up/email", { email: "admin@vocero.com" });
      })
    ).rejects.toThrow();
  });

  it("correo no reservado → no lanza, ni público ni interno", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    const { assertSignUpEmailAllowed, runInternalSignup } = await import("@/lib/auth");
    expect(() =>
      assertSignUpEmailAllowed("/sign-up/email", { email: "dueno@negocio.com" })
    ).not.toThrow();
    await expect(
      runInternalSignup(() => {
        assertSignUpEmailAllowed("/sign-up/email", { email: "miembro@negocio.com" });
        return Promise.resolve(true);
      })
    ).resolves.toBe(true);
  });

  it("otra ruta (ej. /sign-in/email) nunca se evalúa contra la lista reservada", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    const { assertSignUpEmailAllowed } = await import("@/lib/auth");
    expect(() =>
      assertSignUpEmailAllowed("/sign-in/email", { email: "admin@vocero.com" })
    ).not.toThrow();
  });
});
