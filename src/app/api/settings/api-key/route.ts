import { apiError, withAuth } from "@/lib/api";
import { getBotKeyView, issueBotKey, revokeBotKey } from "@/server/bot/keys";

export const dynamic = "force-dynamic";

/**
 * Ajustes → API: la clave del cerebro externo de ESTA organización
 * (contracts/api-key.md). El secreto en claro solo viaja en la respuesta de
 * `POST`; después solo se ven los últimos 4, la fecha de creación y el
 * último uso.
 */

function view(v: { id: string; last4: string; createdAt: Date; lastUsedAt: Date | null }) {
  return {
    id: v.id,
    last4: v.last4,
    createdAt: v.createdAt.toISOString(),
    lastUsedAt: v.lastUsedAt?.toISOString() ?? null,
  };
}

export const GET = withAuth(async (session) => {
  const key = await getBotKeyView(session.organizationId);
  return Response.json(
    { apiKey: key ? view(key) : null },
    { headers: { "cache-control": "no-store" } }
  );
});

/** Genera la primera clave, o ROTA la existente (owner only). */
export const POST = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede generar la clave");
  }
  const { view: v, secret } = await issueBotKey(
    session.organizationId,
    session.userId
  );
  return Response.json(
    { apiKey: view(v), secret },
    { status: 201, headers: { "cache-control": "no-store" } }
  );
});

/** Revoca la clave activa (owner only); sin clave activa, 200 igual (idempotente). */
export const DELETE = withAuth(async (session) => {
  if (session.role !== "owner") {
    return apiError(403, "forbidden", "Solo el propietario puede revocar la clave");
  }
  await revokeBotKey(session.organizationId);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
});
