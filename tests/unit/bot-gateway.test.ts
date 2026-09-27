import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/lib/rate-limit";
import { BOT_API_BUDGET, BOT_AUTH_FAILURES, requireBotKey } from "@/server/bot/auth";
import { mergeFicha, normalizeFicha } from "@/server/bot/ficha";
import { toHandoffReason } from "@/server/bot/handoff";

/** La puerta de toda la superficie `/api/bot/*` — 020: clave POR ORGANIZACIÓN. */

const state = vi.hoisted(() => ({
  keys: new Map<string, { organizationId: string; keyId: string }>(),
  suspended: new Set<string>(),
  lastResolvedOrg: null as string | null,
}));

vi.mock("@/server/bot/keys", () => ({
  resolveBotKey: async (raw: string) => {
    const hit = state.keys.get(raw) ?? null;
    state.lastResolvedOrg = hit?.organizationId ?? null;
    return hit;
  },
  touchBotKeyLastUsed: async () => {},
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            const orgId = state.lastResolvedOrg;
            if (!orgId) return [];
            return [{ suspendedAt: state.suspended.has(orgId) ? new Date() : null }];
          },
        }),
      }),
    }),
  }),
  schema: { organization: { id: "id", suspendedAt: "suspended_at" } },
}));

const KEY_A = "vk_organizacion_a_0123456789abcdef";
const KEY_B = "vk_organizacion_b_0123456789abcdef";

function reqWith(key?: string): Request {
  return new Request("http://localhost/api/bot/context", {
    headers: key ? { "x-api-key": key } : {},
  });
}

async function organizationIdOf(res: Awaited<ReturnType<typeof requireBotKey>>) {
  return res instanceof Response ? null : res.organizationId;
}

describe("requireBotKey", () => {
  beforeEach(() => {
    state.keys.clear();
    state.suspended.clear();
    state.keys.set(KEY_A, { organizationId: "org_a", keyId: "bak_a" });
    state.keys.set(KEY_B, { organizationId: "org_b", keyId: "bak_b" });
    resetRateLimit();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("key correcta → resuelve SU organización", async () => {
    const gate = await requireBotKey(reqWith(KEY_A));
    expect(await organizationIdOf(gate)).toBe("org_a");
  });

  it("la clave de A nunca resuelve a B", async () => {
    const gateA = await requireBotKey(reqWith(KEY_A));
    const gateB = await requireBotKey(reqWith(KEY_B));
    expect(await organizationIdOf(gateA)).toBe("org_a");
    expect(await organizationIdOf(gateB)).toBe("org_b");
    expect(await organizationIdOf(gateA)).not.toBe(await organizationIdOf(gateB));
  });

  it("key incorrecta → 401", async () => {
    const res = await requireBotKey(reqWith("otra-clave-que-no-existe"));
    expect(res instanceof Response && res.status).toBe(401);
  });

  it("sin header → 401", async () => {
    const res = await requireBotKey(reqWith());
    expect(res instanceof Response && res.status).toBe(401);
  });

  it("el antiguo BOT_API_KEY global, aunque siga en el entorno, no resuelve nada → 401", async () => {
    vi.stubEnv("BOT_API_KEY", "vk_global_de_antes_0123456789abcdef");
    const res = await requireBotKey(reqWith("vk_global_de_antes_0123456789abcdef"));
    expect(res instanceof Response && res.status).toBe(401);
  });

  it("organización suspendida → 403 org_suspendida", async () => {
    state.suspended.add("org_a");
    const res = await requireBotKey(reqWith(KEY_A));
    expect(res instanceof Response && res.status).toBe(403);
    const body = res instanceof Response ? await res.json() : null;
    expect((body as { error?: { code?: string } } | null)?.error?.code).toBe(
      "org_suspendida"
    );
  });

  it("una organización suspendida no afecta a las demás", async () => {
    state.suspended.add("org_a");
    const gateB = await requireBotKey(reqWith(KEY_B));
    expect(await organizationIdOf(gateB)).toBe("org_b");
  });
});

/**
 * R11 — El límite ya no es un DoS de regalo. Antes: un cubo global contado
 * ANTES de autenticar, así que 600 requests anónimos por minuto dejaban al
 * cerebro en 429 y a los clientes sin respuesta.
 */
describe("requireBotKey: límites (autentica primero, cuenta después)", () => {
  const MALA = "clave-equivocada-que-no-existe-0000000";

  function desde(ip: string, key?: string): Request {
    return new Request("http://localhost/api/bot/context", {
      headers: {
        "x-forwarded-for": `${ip}, 10.0.0.2`,
        ...(key ? { "x-api-key": key } : {}),
      },
    });
  }

  beforeEach(() => {
    state.keys.clear();
    state.suspended.clear();
    state.keys.set(KEY_A, { organizationId: "org_a", keyId: "bak_a" });
    resetRateLimit();
  });

  it("700 requests sin key desde una IP → el cerebro sigue en 200", async () => {
    const vistos = { 401: 0, 429: 0 };
    for (let i = 0; i < 700; i++) {
      const res = await requireBotKey(desde("203.0.113.9", i % 2 ? MALA : undefined));
      const s = res instanceof Response ? res.status : null;
      if (s === 401 || s === 429) vistos[s]++;
    }
    expect(vistos).toEqual({ 401: BOT_AUTH_FAILURES.max, 429: 700 - BOT_AUTH_FAILURES.max });
    expect(await organizationIdOf(await requireBotKey(desde("198.51.100.7", KEY_A)))).toBe(
      "org_a"
    );
    // Ni aunque comparta IP con quien inunda (mismo proxy, o "local").
    expect(await organizationIdOf(await requireBotKey(desde("203.0.113.9", KEY_A)))).toBe(
      "org_a"
    );
  });

  it("las fallidas se frenan POR IP: 30 → 401, la 31 → 429; otra IP sigue en 401", async () => {
    for (let i = 0; i < BOT_AUTH_FAILURES.max; i++) {
      const res = await requireBotKey(desde("203.0.113.9", MALA));
      expect(res instanceof Response && res.status).toBe(401);
    }
    const overflow = await requireBotKey(desde("203.0.113.9", MALA));
    expect(overflow instanceof Response && overflow.status).toBe(429);
    const otraIp = await requireBotKey(desde("192.0.2.1", MALA));
    expect(otraIp instanceof Response && otraIp.status).toBe(401);
  });

  it("el presupuesto del cerebro autenticado es POR ORGANIZACIÓN", async () => {
    for (let i = 0; i < BOT_API_BUDGET.max; i++) {
      const gate = await requireBotKey(desde("198.51.100.7", KEY_A));
      expect(await organizationIdOf(gate)).toBe("org_a");
    }
    const frenado = await requireBotKey(desde("198.51.100.7", KEY_A));
    expect(frenado instanceof Response && frenado.status).toBe(429);
    // Y los fallidos no se cuentan contra él: su respuesta sigue siendo 401.
    const fallo = await requireBotKey(desde("192.0.2.1"));
    expect(fallo instanceof Response && fallo.status).toBe(401);
  });
});

describe("normalizeFicha (tolerante al drift del LLM)", () => {
  it("las claves las pone el negocio, no el CRM", () => {
    expect(
      normalizeFicha({ tratamiento: "ortodoncia", metros: 120, urgente: true })
    ).toEqual({ tratamiento: "ortodoncia", metros: 120, urgente: true });
  });

  it("recorta espacios y trunca a 500 caracteres", () => {
    const out = normalizeFicha({ notas: "  hola  ", largo: "x".repeat(900) });
    expect(out.notas).toBe("hola");
    expect((out.largo as string).length).toBe(500);
  });

  it("la cadena vacía se descarta; null explícito sobrevive para borrar", () => {
    const out = normalizeFicha({ rubro: "", geo: null });
    expect("rubro" in out).toBe(false);
    expect(out.geo).toBeNull();
  });

  it("objetos y arreglos se ignoran sin reventar", () => {
    expect(normalizeFicha({ nested: { a: 1 }, lista: [1, 2], ok: "sí" })).toEqual({
      ok: "sí",
    });
  });

  it("números no finitos fuera; el cero sí es un dato", () => {
    expect(normalizeFicha({ a: Number.NaN, b: Infinity, empleados: 0 })).toEqual({
      empleados: 0,
    });
  });

  it("claves vacías o larguísimas se descartan", () => {
    const out = normalizeFicha({ "  ": "x", ["k".repeat(80)]: "y", bien: "z" });
    expect(out).toEqual({ bien: "z" });
  });

  it("un bot en bucle no puede inflar la ficha sin límite", () => {
    const raw: Record<string, string> = {};
    for (let i = 0; i < 200; i++) raw[`campo${i}`] = "v";
    expect(Object.keys(normalizeFicha(raw)).length).toBe(40);
  });
});

describe("toHandoffReason (el handoff nunca se pierde por el motivo)", () => {
  it("los motivos del catálogo pasan tal cual", () => {
    for (const r of ["cliente", "modelo", "error", "ventana", "hostilidad"]) {
      expect(toHandoffReason(r)).toBe(r);
    }
  });

  it("un motivo inventado por el LLM cae a 'modelo' en vez de tirar el handoff", () => {
    expect(toHandoffReason("porque el señor se enojó")).toBe("modelo");
  });

  it("ausente o vacío también cae a 'modelo'", () => {
    expect(toHandoffReason(undefined)).toBe("modelo");
    expect(toHandoffReason("   ")).toBe("modelo");
  });

  it("tolera mayúsculas y espacios de sobra", () => {
    expect(toHandoffReason("  Hostilidad ")).toBe("hostilidad");
  });
});

describe("mergeFicha", () => {
  it("lo ausente se conserva y lo nuevo se agrega", () => {
    expect(mergeFicha({ rubro: "dentista" }, { geo: "Querétaro" })).toEqual({
      rubro: "dentista",
      geo: "Querétaro",
    });
  });

  it("un valor nuevo pisa al viejo", () => {
    expect(mergeFicha({ geo: "CDMX" }, { geo: "Querétaro" })).toEqual({
      geo: "Querétaro",
    });
  });

  it("null borra la clave en vez de guardarla en null", () => {
    const out = mergeFicha({ rubro: "dentista", geo: "CDMX" }, { geo: null });
    expect(out).toEqual({ rubro: "dentista" });
  });

  it("sin ficha previa parte de cero", () => {
    expect(mergeFicha(null, { a: 1 })).toEqual({ a: 1 });
  });
});
