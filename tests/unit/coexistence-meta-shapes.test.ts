import { describe, expect, it } from "vitest";
import {
  decodeAccountUpdate,
  decodeCoexistenceDelivery,
  decodeHistoryDelivery,
  decodeStateSync,
} from "@/server/whatsapp/lifecycle";

/**
 * 020 (T040/T041/T052) — Decodificadores de las FORMAS REALES de Meta
 * (contracts/webhook-smb.md), no las de los fixtures anteriores. Los tres
 * campos de coexistence (`account_update`, `smb_app_state_sync`, `history`)
 * y el enrutamiento del buzón durable.
 */

describe("decodeAccountUpdate — real Meta shape (no phone_number_id)", () => {
  it("PARTNER_ADDED y PARTNER_APP_INSTALLED confirman por WABA", () => {
    expect(
      decodeAccountUpdate({ event: "PARTNER_ADDED", waba_info: { waba_id: "WABA-1" } })
    ).toEqual({ kind: "lifecycle", wabaId: "WABA-1", event: "confirmed" });
    expect(
      decodeAccountUpdate({ event: "PARTNER_APP_INSTALLED", waba_info: { waba_id: "WABA-1" } })
    ).toEqual({ kind: "lifecycle", wabaId: "WABA-1", event: "confirmed" });
  });

  it("PARTNER_REMOVED / PARTNER_APP_UNINSTALLED revocan", () => {
    expect(
      decodeAccountUpdate({ event: "PARTNER_REMOVED", waba_info: { waba_id: "WABA-1" } })
    ).toEqual({ kind: "lifecycle", wabaId: "WABA-1", event: "revoked" });
    expect(
      decodeAccountUpdate({ event: "PARTNER_APP_UNINSTALLED", waba_info: { waba_id: "WABA-1" } })
    ).toEqual({ kind: "lifecycle", wabaId: "WABA-1", event: "revoked" });
  });

  it("ACCOUNT_OFFBOARDED / ACCOUNT_DELETED desconectan", () => {
    expect(
      decodeAccountUpdate({ event: "ACCOUNT_OFFBOARDED", waba_info: { waba_id: "WABA-1" } })
    ).toEqual({ kind: "lifecycle", wabaId: "WABA-1", event: "disconnected" });
  });

  it("ACCOUNT_RECONNECTED y eventos desconocidos son no-op (T040)", () => {
    expect(
      decodeAccountUpdate({ event: "ACCOUNT_RECONNECTED", waba_info: { waba_id: "WABA-1" } })
    ).toEqual({ kind: "noop", wabaId: "WABA-1", event: "ACCOUNT_RECONNECTED" });
    expect(
      decodeAccountUpdate({ event: "SOMETHING_FUTURE", waba_info: { waba_id: "WABA-1" } })
    ).toEqual({ kind: "noop", wabaId: "WABA-1", event: "SOMETHING_FUTURE" });
  });

  it("sin waba_info o event → null (nunca se infiere)", () => {
    expect(decodeAccountUpdate({ event: "PARTNER_ADDED" })).toBeNull();
    expect(decodeAccountUpdate({ waba_info: { waba_id: "WABA-1" } })).toBeNull();
    // La forma de fixture anterior (metadata.phone_number_id + coexistence.event) ya no admite nada.
    expect(
      decodeAccountUpdate({ metadata: { phone_number_id: "pn_1" }, coexistence: { event: "confirmed" } })
    ).toBeNull();
  });
});

describe("decodeStateSync — real smb_app_state_sync shape", () => {
  it("admite add/edit como upsert y remove como acción distinta", () => {
    const decoded = decodeStateSync({
      metadata: { phone_number_id: "PN-1" },
      state_sync: [
        {
          type: "contact",
          contact: { full_name: "Ana Pérez", first_name: "Ana", phone_number: "5215500000001" },
          action: "add",
          metadata: { timestamp: "1" },
        },
        {
          type: "contact",
          contact: { full_name: "Ana P.", phone_number: "5215500000001" },
          action: "edit",
          metadata: { timestamp: "2" },
        },
        {
          type: "contact",
          contact: { phone_number: "5215500000002" },
          action: "remove",
          metadata: { timestamp: "3" },
        },
      ],
    });
    expect(decoded?.phoneNumberId).toBe("PN-1");
    expect(decoded?.contacts).toEqual([
      { action: "add", phoneNumber: "5215500000001", fullName: "Ana Pérez", firstName: "Ana" },
      { action: "add", phoneNumber: "5215500000001", fullName: "Ana P.", firstName: null },
      { action: "remove", phoneNumber: "5215500000002", fullName: null, firstName: null },
    ]);
  });

  it("ignora entradas que no son type=contact, sin error", () => {
    const decoded = decodeStateSync({
      metadata: { phone_number_id: "PN-1" },
      state_sync: [{ type: "unknown_future_type" }],
    });
    expect(decoded?.contacts).toEqual([]);
  });

  it("sin metadata.phone_number_id → null", () => {
    expect(decodeStateSync({ state_sync: [] })).toBeNull();
  });
});

describe("decodeHistoryDelivery — real nested threads shape", () => {
  it("decodifica hilos anidados con progreso", () => {
    const decoded = decodeHistoryDelivery({
      metadata: { phone_number_id: "PN-1" },
      history: [
        {
          metadata: { phase: "IN_PROGRESS", chunk_order: 1, progress: 42 },
          threads: [
            {
              id: "5215550000000",
              messages: [
                { id: "wamid.h.1", from: "5215550000000", to: "5215500000000", timestamp: "1", type: "text", text: { body: "hola" } },
                { id: "wamid.h.2", from: "5215500000000", to: "5215550000000", timestamp: "2", type: "text", text: { body: "hola de vuelta" } },
              ],
            },
          ],
        },
      ],
    });
    expect(decoded).toEqual({
      kind: "threads",
      phoneNumberId: "PN-1",
      progress: 42,
      threads: [
        {
          id: "5215550000000",
          messages: [
            expect.objectContaining({ id: "wamid.h.1", from: "5215550000000" }),
            expect.objectContaining({ id: "wamid.h.2", from: "5215500000000" }),
          ],
        },
      ],
    });
  });

  it("declinado (código 2593109) se detecta sin importar threads/metadata", () => {
    const decoded = decodeHistoryDelivery({
      metadata: { phone_number_id: "PN-1" },
      history: [{ errors: [{ code: 2593109, title: "History sync is turned off" }] }],
    });
    expect(decoded).toEqual({ kind: "declined", phoneNumberId: "PN-1" });
  });

  it("sin metadata.phone_number_id o sin history[] → null", () => {
    expect(decodeHistoryDelivery({ history: [] })).toBeNull();
    expect(decodeHistoryDelivery({ metadata: { phone_number_id: "PN-1" } })).toBeNull();
  });
});

describe("decodeCoexistenceDelivery — buzón durable (los seis campos)", () => {
  it("enruta account_update, smb_app_state_sync, history y smb_message_echoes", () => {
    expect(
      decodeCoexistenceDelivery({
        field: "account_update",
        value: { event: "PARTNER_ADDED", waba_info: { waba_id: "WABA-1" } },
      })
    ).toEqual({ kind: "lifecycle", wabaId: "WABA-1", event: "confirmed" });

    expect(
      decodeCoexistenceDelivery({
        field: "account_update",
        value: { event: "ACCOUNT_RECONNECTED", waba_info: { waba_id: "WABA-1" } },
      })
    ).toEqual({ kind: "account_noop", wabaId: "WABA-1", event: "ACCOUNT_RECONNECTED" });

    expect(
      decodeCoexistenceDelivery({
        field: "smb_app_state_sync",
        value: {
          metadata: { phone_number_id: "PN-1" },
          state_sync: [{ type: "contact", contact: { phone_number: "5215500000001" }, action: "add" }],
        },
      })
    ).toEqual({ kind: "state_sync", phoneNumberId: "PN-1" });

    expect(
      decodeCoexistenceDelivery({
        field: "history",
        value: {
          metadata: { phone_number_id: "PN-1" },
          history: [{ threads: [{ id: "5215550000000", messages: [] }] }],
        },
      })
    ).toEqual({ kind: "history", phoneNumberId: "PN-1" });

    expect(
      decodeCoexistenceDelivery({
        field: "smb_message_echoes",
        value: {
          metadata: { phone_number_id: "PN-1" },
          message_echoes: [{ id: "wamid.echo.1" }],
        },
      })
    ).toEqual({ kind: "echo", phoneNumberId: "PN-1" });
  });

  it("los demás campos (messages, message_template_status_update, desconocidos) se ignoran sin error", () => {
    expect(decodeCoexistenceDelivery({ field: "messages", value: {} })).toBeNull();
    expect(decodeCoexistenceDelivery({ field: "message_template_status_update", value: {} })).toBeNull();
    expect(decodeCoexistenceDelivery({ field: "algo_futuro", value: {} })).toBeNull();
  });
});
