import { describe, expect, it } from "vitest";
import {
  computeRetryAt,
  classifyDeliveryFailure,
  canSendWithCoexistenceStatus,
  decodeCoexistenceDelivery,
  deliveryEventKey,
  decodeEchoMutation,
  historyMessageIsEligible,
  nextCoexistenceStatus,
  redactCoexistenceReason,
} from "@/server/whatsapp/lifecycle";

describe("coexistence lifecycle state machine", () => {
  it("only permits monotonic activation and never reactivates a terminal connection", () => {
    expect(nextCoexistenceStatus("awaiting_confirmation", "confirmed")).toBe("active");
    expect(nextCoexistenceStatus("active", "rejected")).toBe("rejected");
    expect(nextCoexistenceStatus("revoked", "confirmed")).toBe("revoked");
  });

  it("redacts untrusted reasons and uses capped exponential retry delays", () => {
    expect(redactCoexistenceReason("token=secret-code rejected")).toBe("Connection rejected");
    expect(computeRetryAt(new Date("2026-01-01T00:00:00.000Z"), 1)).toEqual(
      new Date("2026-01-01T00:00:05.000Z")
    );
    expect(computeRetryAt(new Date("2026-01-01T00:00:00.000Z"), 99)).toEqual(
      new Date("2026-01-01T01:00:00.000Z")
    );
  });
});

describe("fixture-derived coexistence decoder", () => {
  it("admits only the locked minimal lifecycle shape", () => {
    expect(
      decodeCoexistenceDelivery({
        field: "account_update",
        value: { metadata: { phone_number_id: "pn_1" }, coexistence: { event: "confirmed" } },
      })
    ).toEqual({ kind: "lifecycle", phoneNumberId: "pn_1", event: "confirmed" });
  });

  it("rejects unknown field and malformed values without guessing Meta mappings", () => {
    expect(decodeCoexistenceDelivery({ field: "history", value: {} })).toBeNull();
    expect(
      decodeCoexistenceDelivery({ field: "smb_message_echoes", value: { metadata: {} } })
    ).toBeNull();
  });

  it("admits only fixture-shaped echo and history deliveries", () => {
    expect(
      decodeCoexistenceDelivery({
        field: "smb_message_echoes",
        value: {
          metadata: { phone_number_id: "pn_1" },
          message_echoes: [{ id: "wamid.echo.1", timestamp: "1", type: "text", to: "5215550000000" }],
        },
      })
    ).toEqual({ kind: "echo", phoneNumberId: "pn_1" });
    expect(
      decodeCoexistenceDelivery({
        field: "history",
        value: {
          metadata: { phone_number_id: "pn_1" },
          coexistence: { consented_at: "2026-01-01T00:00:00.000Z" },
          messages: [{ id: "wamid.history.1", timestamp: "1", type: "text", from: "5215550000000" }],
        },
      })
    ).toEqual({ kind: "history", phoneNumberId: "pn_1" });
  });

  it("does not admit historical payloads without explicit consent", () => {
    expect(
      decodeCoexistenceDelivery({
        field: "history",
        value: {
          metadata: { phone_number_id: "pn_1" },
          messages: [{ id: "wamid.history.1", timestamp: "1", type: "text", from: "5215550000000" }],
        },
      })
    ).toBeNull();
  });

  it("creates a stable tenant-local delivery key without retaining provider payloads", () => {
    expect(deliveryEventKey("org_a", "history", "pn_1", ["wamid.2", "wamid.1"])).toBe(
      deliveryEventKey("org_a", "history", "pn_1", ["wamid.1", "wamid.2"])
    );
    expect(deliveryEventKey("org_a", "history", "pn_1", ["wamid.1"])).not.toBe(
      deliveryEventKey("org_b", "history", "pn_1", ["wamid.1"])
    );
  });

  it("retries transient deliveries but makes poison work observable and terminal", () => {
    expect(classifyDeliveryFailure(1, new Error("network timeout"))).toEqual({ status: "retryable" });
    expect(classifyDeliveryFailure(5, new Error("network timeout"))).toEqual({ status: "dead" });
    expect(classifyDeliveryFailure(1, new Error("unsupported payload"))).toEqual({ status: "unsupported" });
  });

  it("locks edit and revoke echoes to an original message identity", () => {
    expect(
      decodeEchoMutation({
        id: "wamid.edit.2",
        type: "text",
        context: { id: "wamid.echo.1" },
        edit: { body: "corrected reply" },
      })
    ).toEqual({ kind: "edit", originalMessageId: "wamid.echo.1", text: "corrected reply" });
    expect(
      decodeEchoMutation({
        id: "wamid.revoke.2",
        type: "text",
        context: { id: "wamid.echo.1" },
        revoke: true,
      })
    ).toEqual({ kind: "revoke", originalMessageId: "wamid.echo.1" });
  });

  it("rejects mutations without a locked original id and group history", () => {
    expect(decodeEchoMutation({ id: "wamid.bad", type: "text", edit: { body: "no target" } })).toBeNull();
    expect(historyMessageIsEligible({ id: "wamid.history.1", type: "text", from: "5215550000000" })).toBe(true);
    expect(historyMessageIsEligible({ id: "wamid.history.group", type: "text", from: "1203630@g.us" })).toBe(false);
  });

  it("never permits a terminal coexistence connection to fall back to manual sending", () => {
    expect(canSendWithCoexistenceStatus("active")).toBe(true);
    expect(canSendWithCoexistenceStatus("revoked")).toBe(false);
    expect(canSendWithCoexistenceStatus("disconnected")).toBe(false);
  });
});
