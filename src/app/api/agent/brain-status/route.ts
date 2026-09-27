import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { getEnv, isAiConfigured } from "@/lib/env";
import { getBotKeyView } from "@/server/bot/keys";
import {
  botLastSeenAt,
  computeBrainStatus,
  getBrainHealth,
} from "@/server/bot/status";

export const dynamic = "force-dynamic";

/**
 * «Quién responde a tus clientes»: el agente incluido, el cerebro externo y
 * el aviso de doble respuesta. Ver `server/bot/status.ts`.
 *
 * 020 — "Clave configurada" y "último visto" son de LA ORGANIZACIÓN de la
 * sesión (FR-024): el cerebro de otra organización no aparece aquí.
 */
export const GET = withAuth(async (session) => {
  const db = getDb();
  const [rows, health, botKey] = await Promise.all([
    db
      .select({ enabled: schema.agentProfile.enabled })
      .from(schema.agentProfile)
      .where(scoped(schema.agentProfile.organizationId, session.organizationId))
      .limit(1),
    getBrainHealth(getEnv().BRAIN_HEALTH_URL),
    getBotKeyView(session.organizationId),
  ]);
  const status = computeBrainStatus({
    aiConfigured: isAiConfigured(),
    agentEnabled: rows[0]?.enabled ?? false,
    botKeyConfigured: botKey !== null,
    lastSeenAt: botLastSeenAt(session.organizationId),
    health,
    now: new Date(),
  });
  return Response.json(status, { headers: { "cache-control": "no-store" } });
});
