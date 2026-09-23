import { apiError, withAuth } from "@/lib/api";
import { isWhatsappEmbeddedSignupEnabled } from "@/lib/env";
import { createCoexistenceAttempt } from "@/server/whatsapp/coexistence";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (session) => {
  if (!isWhatsappEmbeddedSignupEnabled()) return apiError(404, "not_found", "Función no habilitada");
  if (session.role !== "owner") return apiError(403, "forbidden", "Solo el dueño puede conectar WhatsApp");
  const attempt = await createCoexistenceAttempt({
    organizationId: session.organizationId,
    ownerUserId: session.userId,
  });
  return Response.json({ attempt });
});
