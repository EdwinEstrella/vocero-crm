import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 020 (D7/FR-043..044/T053) — Sincronización SMB: una sola petición por tipo
 * incluso con confirmaciones repetidas del webhook, `history` depende de que
 * `smb_app_state_sync` haya quedado `requested`, reintento manual condicional
 * (dos clics no duplican), ventana de 24h, y el upsert de la libreta que
 * nunca pisa un nombre `manual`.
 */

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/db")>();
  return { ...original, getDb };
});

const { graphRequest } = vi.hoisted(() => ({ graphRequest: vi.fn() }));
vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const { decryptSecret } = vi.hoisted(() => ({ decryptSecret: vi.fn(() => "decrypted-token") }));
vi.mock("@/lib/crypto", () => ({ decryptSecret, encryptSecret: vi.fn() }));

/**
 * Una BD falsa con un thenable distinto por operación (select/insert/update):
 * cada uno resuelve por su propia cola, así un `await db.update(...).where(...)`
 * sin `.returning()` nunca consume por accidente la cola de `select`.
 */
function fakeDb() {
  const selectQueue: unknown[][] = [];
  const insertReturningQueue: unknown[][] = [];
  const updateReturningQueue: unknown[][] = [];
  const inserted: Record<string, unknown>[] = [];
  const sets: Record<string, unknown>[] = [];

  function selectChain(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    c.from = () => c;
    c.where = () => c;
    c.orderBy = () => c;
    c.limit = () => Promise.resolve(selectQueue.shift() ?? []);
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return c;
  }

  function insertChain(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    c.values = (v: Record<string, unknown>) => {
      inserted.push(v);
      return c;
    };
    c.onConflictDoNothing = () => c;
    c.onConflictDoUpdate = () => c;
    c.returning = () => Promise.resolve(insertReturningQueue.shift() ?? []);
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject);
    return c;
  }

  function updateChain(): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    c.set = (v: Record<string, unknown>) => {
      sets.push(v);
      return c;
    };
    c.where = () => c;
    c.returning = () => Promise.resolve(updateReturningQueue.shift() ?? []);
    c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(undefined).then(resolve, reject);
    return c;
  }

  const db: Record<string, unknown> = {
    select: () => selectChain(),
    insert: () => insertChain(),
    update: () => updateChain(),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: async (fn: (tx: unknown) => Promise<void>) => fn(db),
  };
  getDb.mockReturnValue(db);
  return { selectQueue, insertReturningQueue, updateReturningQueue, inserted, sets };
}

const activatedAt = new Date("2026-09-27T00:00:00.000Z");
const claimRow = {
  phoneNumberId: "PN-1",
  tokenCipher: "c",
  tokenIv: "i",
  tokenTag: "t",
  activatedAt,
};

beforeEach(() => {
  getDb.mockReset();
  graphRequest.mockReset();
});

describe("requestInitialSync — una sola petición por tipo, en orden", () => {
  it("pide contactos y, si quedó requested, pide historial (dos llamadas, en orden)", async () => {
    const { requestInitialSync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue, insertReturningQueue, inserted } = fakeDb();
    selectQueue.push([claimRow]);
    insertReturningQueue.push([{ id: "wss_1" }]); // reclamo smb_app_state_sync
    insertReturningQueue.push([{ id: "wss_2" }]); // reclamo history
    graphRequest.mockResolvedValueOnce({ request_id: "req_contacts" });
    graphRequest.mockResolvedValueOnce({ request_id: "req_history" });

    await requestInitialSync("org_a");

    expect(graphRequest).toHaveBeenCalledTimes(2);
    expect(graphRequest.mock.calls[0]![0]).toBe("PN-1/smb_app_data");
    expect(graphRequest.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      token: "decrypted-token",
      body: { messaging_product: "whatsapp", sync_type: "smb_app_state_sync" },
    });
    expect(graphRequest.mock.calls[1]![1]).toMatchObject({
      body: { sync_type: "history" },
    });
    expect(inserted[0]).toMatchObject({ organizationId: "org_a", phoneNumberId: "PN-1", syncType: "smb_app_state_sync" });
    expect(inserted[1]).toMatchObject({ organizationId: "org_a", syncType: "history" });
  });

  it("si smb_app_state_sync falla, history NUNCA se pide", async () => {
    const { requestInitialSync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue, insertReturningQueue } = fakeDb();
    selectQueue.push([claimRow]);
    insertReturningQueue.push([{ id: "wss_1" }]);
    graphRequest.mockRejectedValueOnce(new Error("boom"));

    await requestInitialSync("org_a");

    expect(graphRequest).toHaveBeenCalledTimes(1);
  });

  it("una confirmación repetida (account_update duplicado) no dispara una segunda llamada a Meta", async () => {
    const { requestInitialSync } = await import("@/server/whatsapp/smb-sync");
    const first = fakeDb();
    first.selectQueue.push([claimRow]);
    first.insertReturningQueue.push([{ id: "wss_1" }]);
    first.insertReturningQueue.push([{ id: "wss_2" }]);
    graphRequest.mockResolvedValueOnce({ request_id: "req_contacts" });
    graphRequest.mockResolvedValueOnce({ request_id: "req_history" });
    await requestInitialSync("org_a");
    expect(graphRequest).toHaveBeenCalledTimes(2);

    // Segunda entrega: el INSERT choca con el UNIQUE (ya existe) para ambos
    // tipos — el fallback de lectura los encuentra ya `requested`.
    const second = fakeDb();
    second.selectQueue.push([claimRow]); // activeClaimToken
    second.insertReturningQueue.push([]); // conflicto: smb_app_state_sync ya existe
    second.selectQueue.push([{ status: "requested" }]); // lectura de esa fila
    second.insertReturningQueue.push([]); // conflicto: history ya existe
    second.selectQueue.push([{ status: "requested" }]);

    await requestInitialSync("org_a");
    expect(graphRequest).toHaveBeenCalledTimes(2); // sin llamadas nuevas
  });
});

describe("retrySync — reintento manual condicional", () => {
  it("sin fila previa → not_found", async () => {
    const { retrySync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue } = fakeDb();
    selectQueue.push([]);
    await expect(retrySync("org_a", "history")).resolves.toBe("not_found");
  });

  it("ventana vencida → window_expired, sin llamar a Meta", async () => {
    const { retrySync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue } = fakeDb();
    selectQueue.push([{ status: "failed", windowExpiresAt: new Date("2000-01-01T00:00:00Z") }]);
    await expect(retrySync("org_a", "history")).resolves.toBe("window_expired");
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("una fila que no está failed (ej. requested) → not_failed", async () => {
    const { retrySync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue } = fakeDb();
    const future = new Date(Date.now() + 60_000);
    selectQueue.push([{ status: "requested", windowExpiresAt: future }]);
    await expect(retrySync("org_a", "history")).resolves.toBe("not_failed");
    expect(graphRequest).not.toHaveBeenCalled();
  });

  it("failed dentro de la ventana → reintenta y pasa a requested", async () => {
    const { retrySync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue, updateReturningQueue, sets } = fakeDb();
    const future = new Date(Date.now() + 60_000);
    selectQueue.push([{ id: "wss_1", status: "failed", windowExpiresAt: future }]);
    selectQueue.push([claimRow]); // activeClaimToken
    updateReturningQueue.push([{ id: "wss_1" }]); // reclamo condicional failed→pending
    graphRequest.mockResolvedValueOnce({ request_id: "req_retry" });

    await expect(retrySync("org_a", "history")).resolves.toBe("retried");
    expect(graphRequest).toHaveBeenCalledTimes(1);
    expect(sets.some((s) => s.status === "requested")).toBe(true);
  });

  it("dos clics: el segundo pierde la carrera del UPDATE condicional (not_failed, sin llamar a Meta otra vez)", async () => {
    const { retrySync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue, updateReturningQueue } = fakeDb();
    const future = new Date(Date.now() + 60_000);
    selectQueue.push([{ id: "wss_1", status: "failed", windowExpiresAt: future }]);
    selectQueue.push([claimRow]);
    updateReturningQueue.push([]); // el otro clic ya lo tomó

    await expect(retrySync("org_a", "history")).resolves.toBe("not_failed");
    expect(graphRequest).not.toHaveBeenCalled();
  });
});

describe("applyStateSync — libreta (add/edit upsert, remove sin efecto, sin teléfono ignorado)", () => {
  it("add crea un contacto nuevo con name_source=libreta", async () => {
    const { applyStateSync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue, insertReturningQueue, inserted, sets } = fakeDb();
    selectQueue.push([]); // findWhatsappContact: no existe
    insertReturningQueue.push([{ id: "ct_1" }]); // insert exitoso

    await applyStateSync("org_a", {
      phoneNumberId: "PN-1",
      contacts: [{ action: "add", phoneNumber: "5215500000001", fullName: "Ana Pérez", firstName: null }],
    });

    expect(inserted[0]).toMatchObject({
      organizationId: "org_a",
      // normalizeMx: el prefijo 521 (México) se normaliza a 52 al escribir.
      waIdentity: "525500000001",
      name: "Ana Pérez",
      nameSource: "libreta",
    });
    expect(sets.some((s) => "itemsReceived" in s)).toBe(true);
  });

  it("add sobre un contacto con nombre manual NUNCA lo pisa", async () => {
    const { applyStateSync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue, sets } = fakeDb();
    selectQueue.push([
      { id: "ct_1", nameSource: "manual", name: "Juan — obra Polanco", archivedAt: null },
    ]);

    await applyStateSync("org_a", {
      phoneNumberId: "PN-1",
      contacts: [{ action: "add", phoneNumber: "5215500000001", fullName: "Otro nombre", firstName: null }],
    });

    // Solo el bump de itemsReceived; ningún UPDATE al contacto (nombre intacto).
    expect(sets).toHaveLength(1);
    expect(sets[0]).toHaveProperty("itemsReceived");
  });

  it("remove no tiene efecto sobre el contacto (sin llamadas a la BD de contacto)", async () => {
    const { applyStateSync } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue, inserted, sets } = fakeDb();

    await applyStateSync("org_a", {
      phoneNumberId: "PN-1",
      contacts: [{ action: "remove", phoneNumber: "5215500000002", fullName: null, firstName: null }],
    });

    expect(selectQueue).toHaveLength(0); // nunca se consultó
    expect(inserted).toHaveLength(0);
    expect(sets).toHaveLength(0); // remove no cuenta como recibido: sin bump
  });

  it("entrada sin teléfono se ignora sin tocar la BD", async () => {
    const { applyStateSync } = await import("@/server/whatsapp/smb-sync");
    const { inserted, sets } = fakeDb();

    await applyStateSync("org_a", {
      phoneNumberId: "PN-1",
      contacts: [{ action: "add", phoneNumber: null, fullName: "Sin teléfono", firstName: null }],
    });

    expect(inserted).toHaveLength(0);
    expect(sets).toHaveLength(0);
  });

  it("el mismo teléfono en dos organizaciones distintas se escribe con su propio organizationId", async () => {
    const { applyStateSync } = await import("@/server/whatsapp/smb-sync");
    const a = fakeDb();
    a.selectQueue.push([]);
    a.insertReturningQueue.push([{ id: "ct_a" }]);
    await applyStateSync("org_a", {
      phoneNumberId: "PN-1",
      contacts: [{ action: "add", phoneNumber: "5215500000009", fullName: "Cliente", firstName: null }],
    });
    expect(a.inserted[0]).toMatchObject({ organizationId: "org_a" });

    const b = fakeDb();
    b.selectQueue.push([]);
    b.insertReturningQueue.push([{ id: "ct_b" }]);
    await applyStateSync("org_b", {
      phoneNumberId: "PN-2",
      contacts: [{ action: "add", phoneNumber: "5215500000009", fullName: "Cliente", firstName: null }],
    });
    expect(b.inserted[0]).toMatchObject({ organizationId: "org_b" });
  });
});

describe("getSyncStatus — expired se calcula, nunca se lee crudo", () => {
  it("una fila pending/failed cuya ventana ya venció se reporta expired", async () => {
    const { getSyncStatus } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue } = fakeDb();
    const past = new Date("2000-01-01T00:00:00Z");
    selectQueue.push([
      { syncType: "smb_app_state_sync", status: "failed", progress: null, windowExpiresAt: past, error: "x" },
      { syncType: "history", status: "requested", progress: 50, windowExpiresAt: past, error: null },
    ]);

    const status = await getSyncStatus("org_a");
    expect(status.contacts?.status).toBe("expired");
    // requested no expira aunque la ventana pasó: ya se pidió, solo falta que Meta entregue.
    expect(status.history?.status).toBe("requested");
    expect(status.history?.progress).toBe(50);
  });

  it("sin filas → ambos null", async () => {
    const { getSyncStatus } = await import("@/server/whatsapp/smb-sync");
    const { selectQueue } = fakeDb();
    selectQueue.push([]);
    await expect(getSyncStatus("org_a")).resolves.toEqual({ contacts: null, history: null });
  });
});
