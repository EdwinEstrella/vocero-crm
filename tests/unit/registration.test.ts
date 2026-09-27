import { afterEach, describe, expect, it, vi } from "vitest";
import { isReservedPlatformEmail } from "@/server/auth/registration";

/**
 * 020 — El registro público SIEMPRE está abierto (D2): la única razón para
 * rechazar un alta pública es que el correo esté reservado para el
 * super-admin (E4/FR-004). El registro cerrado tras la primera organización
 * (FR-060/1.x) queda retirado.
 */

afterEach(() => vi.unstubAllEnvs());

describe("isReservedPlatformEmail", () => {
  it("sin PLATFORM_ADMIN_EMAILS → ningún correo está reservado", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "");
    expect(isReservedPlatformEmail("cualquiera@negocio.com")).toBe(false);
  });

  it("correo listado → reservado", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    expect(isReservedPlatformEmail("admin@vocero.com")).toBe(true);
  });

  it("compara sin distinguir mayúsculas ni espacios de sobra", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    expect(isReservedPlatformEmail("  Admin@Vocero.com  ")).toBe(true);
  });

  it("un correo no listado no se rechaza", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "admin@vocero.com");
    expect(isReservedPlatformEmail("dueno@otronegocio.com")).toBe(false);
  });

  it("varios correos separados por coma", () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "a@x.com,b@x.com");
    expect(isReservedPlatformEmail("b@x.com")).toBe(true);
    expect(isReservedPlatformEmail("c@x.com")).toBe(false);
  });
});
