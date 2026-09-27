import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { retrySync } from "@/server/whatsapp/smb-sync";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ type: z.enum(["smb_app_state_sync", "history"]) });

/**
 * Reintento manual del owner (D7/FR-044): solo filas `failed` dentro de la
 * ventana de 24h. Permitido también al super-admin suplantando — reintentar
 * es una operación de soporte válida (T051); `session.role` ya es `"owner"`
 * en ambos casos (`requireSession`), sin chequeo adicional.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (session.role !== "owner") {
    return apiError(403, "solo_owner", "Solo el dueño puede reintentar la sincronización");
  }
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const outcome = await retrySync(session.organizationId, body.data.type);
  if (outcome === "not_found") {
    return apiError(404, "not_found", "No hay una petición de sincronización para reintentar");
  }
  if (outcome === "window_expired") {
    return apiError(409, "window_expired", "La ventana de 24 horas para sincronizar ya venció");
  }
  if (outcome === "not_failed") {
    return apiError(409, "not_failed", "Solo se puede reintentar una petición que falló");
  }
  return Response.json({ ok: true });
});
