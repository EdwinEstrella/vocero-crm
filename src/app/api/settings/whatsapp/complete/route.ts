import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { isWhatsappEmbeddedSignupEnabled } from "@/lib/env";
import { completeCoexistenceAttempt } from "@/server/whatsapp/coexistence";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  state: z.string().min(1),
  nonce: z.string().min(1),
  code: z.string().min(1),
  wabaId: z.string().min(1),
  phoneNumberId: z.string().min(1),
});

export const POST = withAuth(async (session, req: Request) => {
  if (!isWhatsappEmbeddedSignupEnabled()) return apiError(404, "not_found", "Función no habilitada");
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el dueño puede conectar WhatsApp");
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;
  const outcome = await completeCoexistenceAttempt({ ...body.data, organizationId: session.organizationId, ownerUserId: session.userId });
  if (outcome === "accepted") return Response.json({ ok: true, status: "awaiting_confirmation" });
  if (outcome === "conflict") return apiError(409, "phone_claimed", "El número no está disponible para conectar");
  return apiError(422, outcome, "No se pudo verificar la conexión con Meta");
});
