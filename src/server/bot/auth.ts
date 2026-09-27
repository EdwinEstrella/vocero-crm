import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { apiError } from "@/lib/api";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { markBotSeen } from "@/server/bot/status";
import { resolveBotKey, touchBotKeyLastUsed } from "@/server/bot/keys";

/**
 * Autenticación de la API de servicio `/api/bot/*`.
 *
 * 020 — La clave es POR ORGANIZACIÓN (D5): se genera en Ajustes → API y su
 * sha256 resuelve el tenant del request. La variable global `BOT_API_KEY`
 * queda retirada (E1) — un valor igual a ella se trata como cualquier clave
 * desconocida (401).
 *
 * Primero se autentica y DESPUÉS se cuenta. Antes había un solo cubo global
 * contado antes de mirar la key: 600 requests anónimos por minuto dejaban al
 * cerebro en 429 el resto de la ventana, y los clientes sin respuesta.
 */

/**
 * Presupuesto del cerebro AUTENTICADO, POR ORGANIZACIÓN: 1200/min (20/s
 * sostenidos). Nea hace ~4-10 llamadas por turno de cliente (contexto,
 * "escribiendo…", 1-3 mensajes y, cuando aplica, ficha, handoff, agenda o
 * adjuntos): alcanza para 120-300 turnos por minuto, por encima del pico de
 * un solo negocio. El cerebro de una organización nunca agota el presupuesto
 * de otra (FR de aislamiento, US3-7).
 */
export const BOT_API_BUDGET = { windowMs: 60_000, max: 1200 };

/**
 * Autenticaciones FALLIDAS por IP: 30/min, y luego 429. Jamás tocan el
 * presupuesto de arriba, y una key correcta pasa aunque su IP esté frenada:
 * detrás del mismo proxy (o sin proxy, donde todo es "local") el cerebro puede
 * compartir IP con quien inunda.
 */
export const BOT_AUTH_FAILURES = { windowMs: 60_000, max: 30 };

export type BotGate = { organizationId: string };

export async function requireBotKey(req: Request): Promise<BotGate | Response> {
  const raw = req.headers.get("x-api-key");
  const resolved = raw ? await resolveBotKey(raw) : null;
  if (!resolved) {
    const ip = clientIp(req.headers);
    const fails = checkRateLimit(`bot-api-fail:${ip}`, BOT_AUTH_FAILURES);
    return fails.allowed
      ? apiError(401, "unauthorized", "No autorizado")
      : apiError(429, "rate_limited", "Demasiados intentos fallidos");
  }

  if (await isOrganizationSuspendedForBot(resolved.organizationId)) {
    return apiError(403, "org_suspendida", "Esta organización está suspendida");
  }

  // «Quién responde»: la única huella que deja el cerebro externo en el CRM,
  // por organización (FR-012). Se marca al autenticar, antes del presupuesto:
  // un cerebro frenado por 429 sigue siendo el que contesta.
  markBotSeen(resolved.organizationId);
  void touchBotKeyLastUsed(resolved.keyId).catch(() => {
    // Best-effort: un fallo al anotar "último uso" no puede tumbar el turno.
  });

  const rl = checkRateLimit(
    `bot-api:${resolved.organizationId}`,
    BOT_API_BUDGET
  );
  if (!rl.allowed) return apiError(429, "rate_limited", "Demasiadas solicitudes");

  return { organizationId: resolved.organizationId };
}

/**
 * Chequeo mínimo de suspensión para esta superficie: consulta directa a
 * `organization.suspended_at`, sin caché. El módulo completo de plataforma
 * (suspender/reactivar con su caché de 30s y su auditoría) es el alcance de
 * la fase de plataforma (020, fase 4); aquí solo hace falta negar el acceso
 * de una organización YA marcada como suspendida (US3-6).
 */
async function isOrganizationSuspendedForBot(
  organizationId: string
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .select({ suspendedAt: schema.organization.suspendedAt })
    .from(schema.organization)
    .where(eq(schema.organization.id, organizationId))
    .limit(1);
  return rows[0]?.suspendedAt != null;
}
