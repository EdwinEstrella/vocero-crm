import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { parsePlatformAdminEmails } from "@/lib/env";

/**
 * 020 (D4/FR-030) — Gate del super-admin: sesión de Better Auth +
 * `email_verified = true` + correo (minúsculas, recortado) en
 * `PLATFORM_ADMIN_EMAILS`. Sin membresía: un super-admin no pertenece a
 * ninguna organización (E4).
 *
 * Se evalúa en el SERVIDOR, en cada request — nunca en el cliente ni una vez
 * y se cachea. La superficie de plataforma responde 404 sin cuerpo a
 * cualquier otro (nunca 401/403: no delata que existe).
 */
export function isPlatformAdmin(user: {
  email: string;
  emailVerified: boolean;
}): boolean {
  if (!user.emailVerified) return false;
  const normalized = user.email.trim().toLowerCase();
  return parsePlatformAdminEmails().includes(normalized);
}

/** Lanzado cuando quien pide la superficie de plataforma no es super-admin. */
export class NotPlatformAdminError extends Error {
  constructor(message = "No es super-admin") {
    super(message);
    this.name = "NotPlatformAdminError";
  }
}

export type PlatformAdminContext = {
  userId: string;
  email: string;
  /** Id de la sesión de Better Auth del admin — ancla de la suplantación (E6). */
  sessionId: string;
};

/**
 * Sesión de super-admin para route handlers y server components. Lanza
 * `NotPlatformAdminError` para cualquiera que no cumpla el gate — el llamador
 * lo traduce a `404` sin cuerpo (`notFound()` en páginas,
 * `withPlatformAdmin` en rutas): la superficie no existe para quien no es
 * super-admin.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new NotPlatformAdminError();
  if (!isPlatformAdmin(session.user)) throw new NotPlatformAdminError();
  return {
    userId: session.user.id,
    email: session.user.email,
    sessionId: session.session.id,
  };
}
