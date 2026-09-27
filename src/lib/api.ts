import { z } from "zod";
import {
  requireSession,
  SuspendedOrganizationError,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/auth/session";
import {
  NotPlatformAdminError,
  requirePlatformAdmin,
  type PlatformAdminContext,
} from "@/server/platform/admins";

export type { PlatformAdminContext };

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay,
 * o `403 org_suspendida` si la organización del usuario está suspendida),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof SuspendedOrganizationError) {
        return apiError(403, "org_suspendida", "Esta organización está suspendida");
      }
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/**
 * Envuelve un route handler de plataforma (`/api/platform/*`, FR-030): gate
 * de super-admin en CADA request. Cualquier otro (con o sin sesión, owner
 * incluido) recibe `404` SIN CUERPO — nunca 401/403, para no delatar que la
 * superficie existe.
 */
export function withPlatformAdmin<Args extends unknown[]>(
  handler: (admin: PlatformAdminContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let admin: PlatformAdminContext;
    try {
      admin = await requirePlatformAdmin();
    } catch (err) {
      if (err instanceof NotPlatformAdminError) {
        return new Response(null, { status: 404 });
      }
      throw err;
    }
    try {
      return await handler(admin, ...args);
    } catch (err) {
      console.error("[api] error no controlado (plataforma):", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}

/**
 * Como `parseBody`, pero un body vacío (o ausente) se trata como `{}`: para
 * rutas cuyo cuerpo es enteramente opcional (`POST .../suspend` sin motivo).
 */
export async function parseOptionalBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim().length > 0) {
    try {
      raw = JSON.parse(text);
    } catch {
      return {
        ok: false,
        response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
      };
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
