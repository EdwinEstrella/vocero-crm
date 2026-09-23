import { describe, expect, it } from "vitest";
import {
  buildCoexistenceHistoryPayload,
  buildCoexistenceLifecyclePayload,
} from "@/server/dev/wa-mock-inbound";

describe("development coexistence controls", () => {
  it("builds a narrow lifecycle payload that the production decoder can admit", () => {
    expect(
      buildCoexistenceLifecyclePayload({
        wabaId: "WABA-MOCK",
        phoneNumberId: "PN-MOCK",
        event: "revoked",
      })
    ).toMatchObject({
      object: "whatsapp_business_account",
      entry: [{
        id: "WABA-MOCK",
        changes: [{
          field: "account_update",
          value: { metadata: { phone_number_id: "PN-MOCK" }, coexistence: { event: "revoked" } },
        }],
      }],
    });
  });

  it("requires explicit consent in the history control and preserves supplied message IDs", () => {
    expect(
      buildCoexistenceHistoryPayload({
        wabaId: "WABA-MOCK",
        phoneNumberId: "PN-MOCK",
        consentedAt: "2026-01-01T00:00:00.000Z",
        messages: [{ id: "wamid.history.1", from: "5215550000000", timestamp: "1", type: "text" }],
      })
    ).toMatchObject({
      entry: [{
        changes: [{
          field: "history",
          value: {
            coexistence: { consented_at: "2026-01-01T00:00:00.000Z" },
            messages: [{ id: "wamid.history.1" }],
          },
        }],
      }],
    });
  });
});
