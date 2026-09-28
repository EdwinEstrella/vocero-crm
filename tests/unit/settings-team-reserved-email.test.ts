import { describe, expect, it, vi } from "vitest";

/**
 * 020 (FR-004) — `POST /api/settings/team` traduce el rechazo del hook de
 * Better Auth (`assertSignUpEmailAllowed`, probado en
 * `signup-reserved-email-guard.test.ts`) a `403 correo_reservado` en vez de
 * caer en el genérico `422 invalid`. Antes del fix, ese hook ni se aplicaba a
 * esta ruta interna.
 */

const { getAuth, runInternalSignup, requireSessionMock } = vi.hoisted(() => ({
  getAuth: vi.fn(),
  runInternalSignup: vi.fn((fn: () => Promise<unknown>) => fn()),
  requireSessionMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getAuth, runInternalSignup }));
vi.mock("@/lib/auth/session", () => ({
  requireSession: requireSessionMock,
  UnauthorizedError: class UnauthorizedError extends Error {},
  SuspendedOrganizationError: class SuspendedOrganizationError extends Error {},
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    insert: () => ({ values: () => ({ onConflictDoNothing: async () => {} }) }),
  }),
  schema: { member: {} },
}));

describe("POST /api/settings/team — correo reservado", () => {
  it("intentar crear una cuenta de equipo con el correo reservado → 403 correo_reservado", async () => {
    requireSessionMock.mockResolvedValue({
      userId: "usr_owner",
      organizationId: "org_a",
      role: "owner",
      impersonation: null,
    });
    // El hook real (`assertSignUpEmailAllowed`) rechaza `signUpEmail` con
    // este mensaje cuando el correo está reservado, público o interno.
    getAuth.mockReturnValue({
      api: {
        signUpEmail: async () => {
          throw new Error("correo_reservado");
        },
      },
    });

    const { POST } = await import("@/app/api/settings/team/route");
    const res = await POST(
      new Request("http://localhost/api/settings/team", {
        method: "POST",
        body: JSON.stringify({
          name: "Suplantador",
          email: "admin@vocero.com",
          password: "password123",
        }),
      })
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("correo_reservado");
  });

  it("un error de otro tipo sigue cayendo en 422 invalid (sin regresión)", async () => {
    requireSessionMock.mockResolvedValue({
      userId: "usr_owner",
      organizationId: "org_a",
      role: "owner",
      impersonation: null,
    });
    getAuth.mockReturnValue({
      api: {
        signUpEmail: async () => {
          throw new Error("password too weak");
        },
      },
    });

    const { POST } = await import("@/app/api/settings/team/route");
    const res = await POST(
      new Request("http://localhost/api/settings/team", {
        method: "POST",
        body: JSON.stringify({
          name: "Miembro",
          email: "miembro@negocio.com",
          password: "password123",
        }),
      })
    );
    expect(res.status).toBe(422);
  });
});
