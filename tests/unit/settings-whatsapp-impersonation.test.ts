import { describe, expect, it, vi } from "vitest";

/**
 * 020 (FR-034, extendido) — Durante una suplantación, las mutaciones de la
 * conexión de WhatsApp responden `403 suplantacion_restringida` igual que
 * `team`/`api-key`: el soporte puede VER la organización, pero no cambiar a
 * qué WABA/número o token está atado el negocio (`PUT /api/settings/whatsapp`,
 * y el flujo de coexistence `start`/`complete`/`disconnect`). El reintento de
 * sincronización (`/whatsapp/sync`) queda fuera a propósito: no toca ninguna
 * credencial.
 */

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
  UnauthorizedError: class UnauthorizedError extends Error {},
  SuspendedOrganizationError: class SuspendedOrganizationError extends Error {},
}));

const impersonating = {
  userId: "usr_admin",
  organizationId: "org_a",
  role: "owner" as const,
  impersonation: { id: "imp_1", organizationName: "Negocio A", suspended: false },
};

describe("suplantación restringida — conexión de WhatsApp", () => {
  it("PUT /api/settings/whatsapp → 403 suplantacion_restringida, sin re-validar contra Meta", async () => {
    requireSessionMock.mockResolvedValue(impersonating);
    const { PUT } = await import("@/app/api/settings/whatsapp/route");
    const res = await PUT(
      new Request("http://localhost/api/settings/whatsapp", {
        method: "PUT",
        body: JSON.stringify({ wabaId: "WABA-1", phoneNumberId: "PN-1", token: "tok" }),
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("suplantacion_restringida");
  });

  it("POST /api/settings/whatsapp/start → 403 suplantacion_restringida", async () => {
    vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP", "on");
    vi.stubEnv("META_APP_SECRET", "secret");
    vi.stubEnv("META_APP_ID", "app-id");
    vi.stubEnv("META_EMBEDDED_SIGNUP_CONFIG_ID", "config-id");
    requireSessionMock.mockResolvedValue(impersonating);
    const { POST } = await import("@/app/api/settings/whatsapp/start/route");
    const res = await POST();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("suplantacion_restringida");
    vi.unstubAllEnvs();
  });

  it("POST /api/settings/whatsapp/disconnect → 403 suplantacion_restringida", async () => {
    vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP", "on");
    vi.stubEnv("META_APP_SECRET", "secret");
    vi.stubEnv("META_APP_ID", "app-id");
    vi.stubEnv("META_EMBEDDED_SIGNUP_CONFIG_ID", "config-id");
    requireSessionMock.mockResolvedValue(impersonating);
    const { POST } = await import("@/app/api/settings/whatsapp/disconnect/route");
    const res = await POST();
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("suplantacion_restringida");
    vi.unstubAllEnvs();
  });

  it("POST /api/settings/whatsapp/complete → 403 suplantacion_restringida", async () => {
    vi.stubEnv("WHATSAPP_EMBEDDED_SIGNUP", "on");
    vi.stubEnv("META_APP_SECRET", "secret");
    vi.stubEnv("META_APP_ID", "app-id");
    vi.stubEnv("META_EMBEDDED_SIGNUP_CONFIG_ID", "config-id");
    requireSessionMock.mockResolvedValue(impersonating);
    const { POST } = await import("@/app/api/settings/whatsapp/complete/route");
    const res = await POST(
      new Request("http://localhost/api/settings/whatsapp/complete", {
        method: "POST",
        body: JSON.stringify({
          state: "s",
          nonce: "n",
          code: "c",
          wabaId: "WABA-1",
          phoneNumberId: "PN-1",
        }),
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("suplantacion_restringida");
    vi.unstubAllEnvs();
  });
});
