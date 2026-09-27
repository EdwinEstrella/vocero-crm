import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { resolveMembership } from "@/server/auth/on-signup";
import { isPlatformAdmin } from "@/server/platform/admins";
import {
  IMPERSONATION_COOKIE,
  resolveImpersonation,
} from "@/server/platform/impersonation";

export type SessionContext = {
  userId: string;
  organizationId: string;
  role: string;
  /**
   * 020 (E6) — Suplantación activa del super-admin sobre esta organización, o
   * `null` en una sesión normal. `suspended` refleja el estado ACTUAL de la
   * organización suplantada (E7: se permite suplantar una suspendida).
   */
  impersonation: { id: string; organizationName: string; suspended: boolean } | null;
};

export class UnauthorizedError extends Error {
  constructor(message = "No autenticado") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** 020 (FR-005/006) — La organización del usuario está suspendida. */
export class SuspendedOrganizationError extends Error {
  constructor(message = "Esta organización está suspendida") {
    super(message);
    this.name = "SuspendedOrganizationError";
  }
}

/**
 * 020 — Super-admin con sesión pero sin suplantación activa: sigue siendo
 * `UnauthorizedError` para la API (401, igual que hoy), pero las páginas de
 * la app lo distinguen para mandarlo a `/admin` en vez de `/login`.
 */
export class PlatformAdminWithoutImpersonationError extends UnauthorizedError {
  constructor() {
    super("Sesión de super-admin sin suplantación activa");
    this.name = "PlatformAdminWithoutImpersonationError";
  }
}

/**
 * Sesión + organización activa para route handlers y server components.
 *
 * 020 — Un super-admin (E4) no tiene membresía: solo entra a una organización
 * mediante una suplantación válida (cookie `vocero_imp` + misma sesión de
 * Better Auth). Sin ella, se comporta como hoy para la app: `401` (ya sin
 * organización, las páginas lo mandan a `/admin`, no aquí).
 */
export async function requireSession(): Promise<SessionContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();

  if (isPlatformAdmin(session.user)) {
    const cookieId = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
    const impersonation = await resolveImpersonation(
      { userId: session.user.id, email: session.user.email },
      session.session.id,
      cookieId
    );
    if (!impersonation) {
      throw new PlatformAdminWithoutImpersonationError();
    }
    return {
      userId: session.user.id,
      organizationId: impersonation.organizationId,
      role: "owner",
      impersonation: {
        id: impersonation.id,
        organizationName: impersonation.organizationName,
        suspended: impersonation.suspended,
      },
    };
  }

  // La sesión puede crearse antes de que la membresía exista (registro
  // inicial) — la membresía en BD es la fuente de verdad de org + rol.
  const membership = await resolveMembership(session.user.id);
  if (!membership) {
    throw new UnauthorizedError("Sesión sin organización activa");
  }
  if (membership.suspendedAt) {
    throw new SuspendedOrganizationError();
  }
  return {
    userId: session.user.id,
    organizationId: membership.organizationId,
    role: membership.role,
    impersonation: null,
  };
}

/** Igual que requireSession pero devuelve null en vez de lanzar. */
export async function getSessionOrNull(): Promise<SessionContext | null> {
  try {
    return await requireSession();
  } catch {
    return null;
  }
}
