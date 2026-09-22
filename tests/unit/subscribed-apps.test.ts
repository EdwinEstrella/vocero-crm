import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { subscribeAppToWaba } from "@/server/whatsapp/connect";

/**
 * Guardar la conexión de WhatsApp suscribe la app a la WABA, pero SIN borrar
 * un override de callback: en Meta, `POST {WABA}/subscribed_apps` sin cuerpo
 * es exactamente cómo se elimina el callback alterno, y con eso un cerebro
 * externo (Nea) o el backend de una agencia dejaba de recibir mensajes cada
 * vez que alguien pulsaba "Guardar" o rotaba el token.
 */

const { graphRequest } = vi.hoisted(() => ({ graphRequest: vi.fn() }));

vi.mock("@/lib/meta/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/meta/client")>();
  return { ...original, graphRequest };
});

const WABA = "WABA-1";
const TOKEN = "EAAG-token-secreto-1234";
const APP = { id: "123", name: "Mi app", link: "https://www.facebook.com/games/?app_id=123" };
/** El override de Vocero lleva el verify token como segmento secreto. */
const OVERRIDE = "https://nea.ejemplo.com/api/webhooks/wa/segmento-secreto-abc";

type Call = [path: string, opts: { method?: string; token: string; body?: unknown }];
const calls = () => graphRequest.mock.calls as Call[];
const posts = () => calls().filter(([, opts]) => opts.method === "POST");

let log: MockInstance<typeof console.log>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  graphRequest.mockReset();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  log.mockRestore();
  warn.mockRestore();
});

/** Todo lo que se escribió en consola, para buscar secretos filtrados. */
function consoleText(): string {
  return [...log.mock.calls, ...warn.mock.calls].flat().map(String).join("\n");
}

describe("subscribeAppToWaba — la WABA ya enruta a un override", () => {
  it("consulta subscribed_apps y NO re-suscribe (un POST sin cuerpo borraría el override)", async () => {
    graphRequest.mockResolvedValueOnce({
      data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }],
    });

    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("override_kept");

    expect(calls()).toHaveLength(1);
    const [path, opts] = calls()[0]!;
    expect(path).toBe(`${WABA}/subscribed_apps`);
    expect(opts.method ?? "GET").toBe("GET");
    expect(opts.token).toBe(TOKEN);
    expect(posts()).toHaveLength(0);
  });

  it("lo deja dicho en el log, sin el token ni la ruta secreta del webhook", async () => {
    graphRequest.mockResolvedValueOnce({
      data: [{ whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE }],
    });

    await subscribeAppToWaba(WABA, TOKEN);

    const text = consoleText();
    expect(text).toMatch(/override/);
    expect(text).toContain(WABA);
    expect(text).toContain("nea.ejemplo.com");
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("segmento-secreto-abc");
  });

  it("basta con que UNA de las apps suscritas tenga override", async () => {
    graphRequest.mockResolvedValueOnce({
      data: [
        { whatsapp_business_api_data: { id: "999", name: "Otra app" } },
        { whatsapp_business_api_data: APP, override_callback_uri: OVERRIDE },
      ],
    });

    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("override_kept");
    expect(posts()).toHaveLength(0);
  });
});

describe("subscribeAppToWaba — sin override (modo directo)", () => {
  it("app suscrita sin override → suscribe como siempre", async () => {
    graphRequest
      .mockResolvedValueOnce({ data: [{ whatsapp_business_api_data: APP }] })
      .mockResolvedValueOnce({ success: true });

    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("subscribed");

    expect(posts()).toEqual([[`${WABA}/subscribed_apps`, { method: "POST", token: TOKEN }]]);
  });

  it("ninguna app suscrita todavía (data vacío) → suscribe", async () => {
    graphRequest
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ success: true });

    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("subscribed");
    expect(posts()).toHaveLength(1);
  });

  it("un override vacío o en blanco no cuenta como override", async () => {
    graphRequest
      .mockResolvedValueOnce({
        data: [{ whatsapp_business_api_data: APP, override_callback_uri: "  " }],
      })
      .mockResolvedValueOnce({ success: true });

    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("subscribed");
    expect(posts()).toHaveLength(1);
  });

  it("una respuesta sin `data` (o vacía) se trata como sin override", async () => {
    graphRequest.mockResolvedValueOnce({}).mockResolvedValueOnce({ success: true });
    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("subscribed");

    graphRequest.mockResolvedValueOnce(null).mockResolvedValueOnce({ success: true });
    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("subscribed");

    expect(posts()).toHaveLength(2);
  });
});

describe("subscribeAppToWaba — la consulta falla", () => {
  it("se conserva el POST best-effort de siempre", async () => {
    graphRequest
      .mockRejectedValueOnce(
        new MetaApiError("(#200) Permissions error", { status: 403, code: 200 })
      )
      .mockResolvedValueOnce({ success: true });

    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("subscribed");
    expect(posts()).toHaveLength(1);
  });

  it("si también falla la suscripción, lo registra y NO lanza (guardar sigue)", async () => {
    graphRequest
      .mockRejectedValueOnce(new MetaApiError("No se pudo contactar la API de Meta", { status: 0 }))
      .mockRejectedValueOnce(new MetaApiError("No se pudo contactar la API de Meta", { status: 0 }));

    await expect(subscribeAppToWaba(WABA, TOKEN)).resolves.toBe("failed");
    expect(posts()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    expect(consoleText()).not.toContain(TOKEN);
  });
});
