import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";

/**
 * 020 (D5/FR-020..024) — Clave de API del cerebro externo, UNA por
 * organización. Se genera/rota/revoca en Ajustes → API (owner) y se guarda
 * como sha256; solo la respuesta que la crea trae el secreto en claro. La
 * variable global `BOT_API_KEY` queda retirada (E1): con N organizaciones no
 * hay "la" instancia a la que asignársela.
 */

const KEY_PREFIX = "vk_";
/** ≥ 32 bytes aleatorios (FR-021); 32 bytes en base64url ⇒ 43 caracteres. */
const KEY_BYTES = 32;

export function generateBotKey(): string {
  return `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString("base64url")}`;
}

export function hashBotKey(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type BotApiKeyView = {
  id: string;
  last4: string;
  createdAt: Date;
  lastUsedAt: Date | null;
};

/** La clave activa (no revocada) de la organización, sin el secreto. */
export async function getBotKeyView(
  organizationId: string
): Promise<BotApiKeyView | null> {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.botApiKey.id,
      last4: schema.botApiKey.last4,
      createdAt: schema.botApiKey.createdAt,
      lastUsedAt: schema.botApiKey.lastUsedAt,
    })
    .from(schema.botApiKey)
    .where(
      and(
        eq(schema.botApiKey.organizationId, organizationId),
        isNull(schema.botApiKey.revokedAt)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Genera la primera clave, o ROTA la existente (revoca la anterior en la
 * misma transacción, FR-020). Devuelve la vista + el secreto en claro: es la
 * ÚNICA respuesta que lo trae.
 */
export async function issueBotKey(
  organizationId: string,
  createdByUserId: string
): Promise<{ view: BotApiKeyView; secret: string }> {
  const secret = generateBotKey();
  const keyHash = hashBotKey(secret);
  const last4 = secret.slice(-4);
  const id = newId("botApiKey");
  const createdAt = new Date();

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.botApiKey)
      .set({ revokedAt: createdAt })
      .where(
        and(
          eq(schema.botApiKey.organizationId, organizationId),
          isNull(schema.botApiKey.revokedAt)
        )
      );
    await tx.insert(schema.botApiKey).values({
      id,
      organizationId,
      keyHash,
      last4,
      createdByUserId,
      createdAt,
    });
  });

  return { view: { id, last4, createdAt, lastUsedAt: null }, secret };
}

/** Revoca la clave activa; sin clave activa, no hace nada (idempotente). */
export async function revokeBotKey(organizationId: string): Promise<void> {
  const db = getDb();
  await db
    .update(schema.botApiKey)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.botApiKey.organizationId, organizationId),
        isNull(schema.botApiKey.revokedAt)
      )
    );
}

export type ResolvedBotKey = { organizationId: string; keyId: string };

/**
 * Resuelve el `X-API-Key` recibido a SU organización, buscando por el sha256
 * entre las claves no revocadas (FR-022). Sin coincidencia → null: la clave
 * de A jamás resuelve a B, y una clave revocada o el antiguo `BOT_API_KEY`
 * global caen aquí igual que cualquier valor desconocido.
 */
export async function resolveBotKey(raw: string): Promise<ResolvedBotKey | null> {
  if (!raw) return null;
  const keyHash = hashBotKey(raw);
  const db = getDb();
  const rows = await db
    .select({
      id: schema.botApiKey.id,
      organizationId: schema.botApiKey.organizationId,
    })
    .from(schema.botApiKey)
    .where(
      and(eq(schema.botApiKey.keyHash, keyHash), isNull(schema.botApiKey.revokedAt))
    )
    .limit(1);
  const row = rows[0];
  return row ? { organizationId: row.organizationId, keyId: row.id } : null;
}

/**
 * `last_used_at` como mucho una escritura por minuto por clave (contrato
 * api-key.md): el throttle vive en memoria de proceso, así que un cerebro que
 * llama varias veces por segundo no multiplica los UPDATE.
 */
const lastTouch = new Map<string, number>();
const TOUCH_THROTTLE_MS = 60_000;

export async function touchBotKeyLastUsed(keyId: string): Promise<void> {
  const now = Date.now();
  const last = lastTouch.get(keyId);
  if (last !== undefined && now - last < TOUCH_THROTTLE_MS) return;
  lastTouch.set(keyId, now);
  const db = getDb();
  await db
    .update(schema.botApiKey)
    .set({ lastUsedAt: new Date(now) })
    .where(eq(schema.botApiKey.id, keyId));
}

/** Solo para tests. */
export function resetBotKeyTouchThrottle(): void {
  lastTouch.clear();
}
