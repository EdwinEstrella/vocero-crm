import { describe, expect, it } from "vitest";
import { parsePlatformAdminEmails } from "@/lib/env";

/**
 * 020 — Quién es super-admin lo define el operador por entorno
 * (`PLATFORM_ADMIN_EMAILS`), nunca un registro. Aquí solo se prueba el
 * parseo; la comprobación contra la sesión vive en
 * `src/server/platform/admins.ts`.
 */

describe("parsePlatformAdminEmails", () => {
  it("ausente → nadie es admin", () => {
    expect(parsePlatformAdminEmails(undefined)).toEqual([]);
  });

  it("vacía → nadie es admin", () => {
    expect(parsePlatformAdminEmails("")).toEqual([]);
  });

  it("un correo → esa lista", () => {
    expect(parsePlatformAdminEmails("admin@vocero.com")).toEqual([
      "admin@vocero.com",
    ]);
  });

  it("varios correos separados por coma, mayúsculas y espacios normalizados", () => {
    expect(
      parsePlatformAdminEmails(" Admin@Vocero.com , otro@Vocero.com ,tercero@vocero.com")
    ).toEqual(["admin@vocero.com", "otro@vocero.com", "tercero@vocero.com"]);
  });

  it("entradas vacías entre comas se descartan", () => {
    expect(parsePlatformAdminEmails("a@x.com,,  ,b@x.com,")).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });

  it("solo comas y espacios → lista vacía", () => {
    expect(parsePlatformAdminEmails(" , , ")).toEqual([]);
  });
});
