import { describe, expect, it } from "vitest";
import {
  buildCoexistenceHistoryPayload,
  buildCoexistenceLifecyclePayload,
  buildStateSyncPayload,
} from "@/server/dev/wa-mock-inbound";

describe("development coexistence controls — real Meta shapes", () => {
  it("builds an account_update payload with no phone_number_id, routed by WABA", () => {
    expect(
      buildCoexistenceLifecyclePayload({
        wabaId: "WABA-MOCK",
        event: "PARTNER_REMOVED",
      })
    ).toMatchObject({
      object: "whatsapp_business_account",
      entry: [{
        id: "WABA-MOCK",
        changes: [{
          field: "account_update",
          value: { event: "PARTNER_REMOVED", waba_info: { waba_id: "WABA-MOCK" } },
        }],
      }],
    });
  });

  it("builds a smb_app_state_sync payload with contact entries", () => {
    expect(
      buildStateSyncPayload({
        wabaId: "WABA-MOCK",
        phoneNumberId: "PN-MOCK",
        entries: [{ action: "add", fullName: "Ana Pérez", phoneNumber: "5215500000001" }],
      })
    ).toMatchObject({
      entry: [{
        id: "WABA-MOCK",
        changes: [{
          field: "smb_app_state_sync",
          value: {
            metadata: { phone_number_id: "PN-MOCK" },
            state_sync: [{
              type: "contact",
              contact: { full_name: "Ana Pérez", phone_number: "5215500000001" },
              action: "add",
            }],
          },
        }],
      }],
    });
  });

  it("builds a nested-threads history payload", () => {
    expect(
      buildCoexistenceHistoryPayload({
        wabaId: "WABA-MOCK",
        phoneNumberId: "PN-MOCK",
        threads: [{ id: "5215550000000", messages: [{ id: "wamid.history.1", from: "5215550000000", timestamp: "1", type: "text" }] }],
      })
    ).toMatchObject({
      entry: [{
        changes: [{
          field: "history",
          value: {
            metadata: { phone_number_id: "PN-MOCK" },
            history: [{
              threads: [{ id: "5215550000000", messages: [{ id: "wamid.history.1" }] }],
            }],
          },
        }],
      }],
    });
  });

  it("builds a declined history payload (error code 2593109)", () => {
    expect(
      buildCoexistenceHistoryPayload({ wabaId: "WABA-MOCK", phoneNumberId: "PN-MOCK", declined: true })
    ).toMatchObject({
      entry: [{
        changes: [{
          field: "history",
          value: { history: [{ errors: [{ code: 2593109 }] }] },
        }],
      }],
    });
  });
});
