import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

/**
 * 020 (D5/FR-020..024) — La clave de API del cerebro externo es POR
 * ORGANIZACIÓN: se guarda como sha256 y su búsqueda resuelve el tenant. Lo
 * que se protege aquí: que la clave de A jamás resuelva a B, que revocar o
 * rotar invalide la anterior EN EL ACTO, y que el viejo `BOT_API_KEY` global
 * no participe en absoluto.
 */

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));

vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb };
});

/** Una BD falsa: `select().where().limit()` devuelve las filas encoladas y
 *  guarda cada WHERE; `update`/`insert`/`transaction` solo registran la llamada. */
function fakeDb(queue: unknown[][] = []) {
  const wheres: SQL[] = [];
  const sets: Record<string, unknown>[] = [];
  const inserted: Record<string, unknown>[] = [];

  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.from = () => chain;
  chain.where = (w: SQL) => {
    wheres.push(w);
    return chain;
  };
  chain.limit = () => Promise.resolve(queue.shift() ?? []);
  chain.update = () => chain;
  chain.set = (v: Record<string, unknown>) => {
    sets.push(v);
    return chain;
  };
  chain.insert = () => chain;
  chain.values = (v: Record<string, unknown>) => {
    inserted.push(v);
    return Promise.resolve();
  };
  chain.transaction = async (fn: (tx: typeof chain) => Promise<void>) => {
    await fn(chain);
  };

  getDb.mockReturnValue(chain);
  return { wheres, sets, inserted };
}

const sqlDe = (w: SQL) => new PgDialect().sqlToQuery(w);

beforeEach(() => getDb.mockReset());

describe("generateBotKey / hashBotKey", () => {
  it("prefijo vk_ y ≥ 32 bytes aleatorios (43 chars base64url tras el prefijo)", async () => {
    const { generateBotKey } = await import("@/server/bot/keys");
    const key = generateBotKey();
    expect(key.startsWith("vk_")).toBe(true);
    expect(key.slice(3)).toHaveLength(43);
    expect(key.slice(3)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("cada clave generada es distinta (entropía real, no un valor fijo)", async () => {
    const { generateBotKey } = await import("@/server/bot/keys");
    const keys = new Set(Array.from({ length: 20 }, () => generateBotKey()));
    expect(keys.size).toBe(20);
  });

  it("hashBotKey es estable (mismo valor → mismo hash) y sensible al valor", async () => {
    const { hashBotKey } = await import("@/server/bot/keys");
    expect(hashBotKey("vk_igual")).toBe(hashBotKey("vk_igual"));
    expect(hashBotKey("vk_a")).not.toBe(hashBotKey("vk_b"));
    expect(hashBotKey("vk_igual")).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });
});

describe("resolveBotKey — aislamiento entre organizaciones", () => {
  it("la clave de A resuelve A por su hash exacto, nunca cualquier otro", async () => {
    const { resolveBotKey, hashBotKey } = await import("@/server/bot/keys");
    const { wheres } = fakeDb([[{ id: "bak_a", organizationId: "org_a" }]]);

    const out = await resolveBotKey("vk_de_la_organizacion_a");
    expect(out).toEqual({ organizationId: "org_a", keyId: "bak_a" });

    const q = sqlDe(wheres[0]!);
    expect(q.sql).toContain('"key_hash" = ');
    expect(q.sql.toLowerCase()).toContain('"revoked_at" is null');
    expect(q.params).toEqual([hashBotKey("vk_de_la_organizacion_a")]);
  });

  it("la clave de B, buscada con el hash de B, jamás trae a A", async () => {
    const { resolveBotKey } = await import("@/server/bot/keys");
    fakeDb([[{ id: "bak_b", organizationId: "org_b" }]]);
    const out = await resolveBotKey("vk_de_la_organizacion_b");
    expect(out?.organizationId).toBe("org_b");
    expect(out?.organizationId).not.toBe("org_a");
  });

  it("clave revocada o desconocida (incluida BOT_API_KEY global) → null", async () => {
    const { resolveBotKey } = await import("@/server/bot/keys");
    fakeDb([[]]); // sin fila: revocada, o cualquier valor que no está en la tabla
    await expect(resolveBotKey("BOT_API_KEY_global_de_antes")).resolves.toBeNull();
  });

  it("cadena vacía no consulta nada → null", async () => {
    const { resolveBotKey } = await import("@/server/bot/keys");
    const { wheres } = fakeDb([]);
    await expect(resolveBotKey("")).resolves.toBeNull();
    expect(wheres).toHaveLength(0);
  });
});

describe("issueBotKey — generar y rotar", () => {
  it("primera clave: inserta y no revoca nada (transacción)", async () => {
    const { issueBotKey } = await import("@/server/bot/keys");
    const { sets, inserted } = fakeDb();

    const { view, secret } = await issueBotKey("org_a", "user_1");
    expect(secret.startsWith("vk_")).toBe(true);
    expect(view.last4).toBe(secret.slice(-4));
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ organizationId: "org_a", createdByUserId: "user_1" });
    // El UPDATE de "revocar la anterior" sí corre (siempre, idempotente): sin
    // fila que cumpla la condición, no revoca nada de verdad.
    expect(sets).toHaveLength(1);
    expect(sets[0]).toHaveProperty("revokedAt");
  });

  it("rotar: la clave anterior se revoca EN LA MISMA TRANSACCIÓN que la nueva se inserta", async () => {
    const { issueBotKey } = await import("@/server/bot/keys");
    const { sets, inserted } = fakeDb();
    const primera = await issueBotKey("org_a", "user_1");
    const segunda = await issueBotKey("org_a", "user_1");

    expect(segunda.secret).not.toBe(primera.secret);
    expect(inserted).toHaveLength(2);
    expect(sets).toHaveLength(2); // una revocación por llamada a issueBotKey
  });
});

describe("revokeBotKey", () => {
  it("revoca la activa; sin clave activa, no truena (idempotente)", async () => {
    const { revokeBotKey } = await import("@/server/bot/keys");
    const { sets } = fakeDb();
    await revokeBotKey("org_a");
    expect(sets).toHaveLength(1);
    expect(sets[0]).toHaveProperty("revokedAt");
  });
});

describe("getBotKeyView", () => {
  it("sin clave activa → null", async () => {
    const { getBotKeyView } = await import("@/server/bot/keys");
    fakeDb([[]]);
    await expect(getBotKeyView("org_a")).resolves.toBeNull();
  });

  it("con clave activa → la vista, sin el hash ni el secreto", async () => {
    const { getBotKeyView } = await import("@/server/bot/keys");
    const createdAt = new Date("2026-09-27T00:00:00Z");
    fakeDb([[{ id: "bak_1", last4: "Q9xZ", createdAt, lastUsedAt: null }]]);
    const view = await getBotKeyView("org_a");
    expect(view).toEqual({ id: "bak_1", last4: "Q9xZ", createdAt, lastUsedAt: null });
    expect(view).not.toHaveProperty("keyHash");
  });
});

describe("touchBotKeyLastUsed — como mucho una escritura por minuto", () => {
  beforeEach(async () => {
    const { resetBotKeyTouchThrottle } = await import("@/server/bot/keys");
    resetBotKeyTouchThrottle();
  });
  afterEach(() => vi.useRealTimers());

  it("dos llamadas seguidas para la misma clave → un solo UPDATE", async () => {
    const { touchBotKeyLastUsed } = await import("@/server/bot/keys");
    const { sets } = fakeDb();
    await touchBotKeyLastUsed("bak_1");
    await touchBotKeyLastUsed("bak_1");
    expect(sets).toHaveLength(1);
  });

  it("pasado el minuto, vuelve a escribir", async () => {
    vi.useFakeTimers();
    const { touchBotKeyLastUsed } = await import("@/server/bot/keys");
    const { sets } = fakeDb();
    await touchBotKeyLastUsed("bak_1");
    vi.advanceTimersByTime(61_000);
    await touchBotKeyLastUsed("bak_1");
    expect(sets).toHaveLength(2);
  });
});
