import { describe, expect, it } from "vitest";
import {
  canMutateCoexistence,
  canPresentEmbeddedSignup,
  decodeEmbeddedSignupExchange,
  hashAttemptSecret,
  isAttemptUsable,
  redactAttemptForOwner,
  redactCoexistenceStatus,
} from "@/server/whatsapp/coexistence";
import { getWhatsappEmbeddedSignupAvailability } from "@/lib/env";

describe("coexistence onboarding guards", () => {
  it("explains which first-party configuration is missing instead of hiding coexistence behind manual WABA setup", () => {
    expect(
      getWhatsappEmbeddedSignupAvailability({
        WHATSAPP_EMBEDDED_SIGNUP: undefined,
        META_APP_SECRET: undefined,
        META_APP_ID: undefined,
        META_EMBEDDED_SIGNUP_CONFIG_ID: undefined,
      })
    ).toEqual({
      state: "disabled",
      missing: ["WHATSAPP_EMBEDDED_SIGNUP", "META_APP_SECRET", "META_APP_ID", "META_EMBEDDED_SIGNUP_CONFIG_ID"],
    });
    expect(
      getWhatsappEmbeddedSignupAvailability({
        WHATSAPP_EMBEDDED_SIGNUP: "on",
        META_APP_SECRET: undefined,
        META_APP_ID: undefined,
        META_EMBEDDED_SIGNUP_CONFIG_ID: undefined,
      })
    ).toEqual({
      state: "configuration_required",
      missing: ["META_APP_SECRET", "META_APP_ID", "META_EMBEDDED_SIGNUP_CONFIG_ID"],
    });
    expect(
      getWhatsappEmbeddedSignupAvailability({
        WHATSAPP_EMBEDDED_SIGNUP: "on",
        META_APP_SECRET: "app-secret",
        META_APP_ID: "app-id",
        META_EMBEDDED_SIGNUP_CONFIG_ID: "config-id",
      })
    ).toEqual({ state: "available", missing: [] });
  });

  it("presents Embedded Signup only to an owner when the optional module is enabled", () => {
    expect(canPresentEmbeddedSignup({ enabled: true, role: "owner" })).toBe(true);
    expect(canPresentEmbeddedSignup({ enabled: true, role: "member" })).toBe(false);
    expect(canPresentEmbeddedSignup({ enabled: false, role: "owner" })).toBe(false);
  });

  it("allows only owners to mutate a bound, unconsumed attempt", () => {
    expect(canMutateCoexistence("owner")).toBe(true);
    expect(canMutateCoexistence("member")).toBe(false);
    expect(
      isAttemptUsable({ consumedAt: null, expiresAt: new Date("2026-01-01T01:00:00Z") }, new Date("2026-01-01T00:00:00Z"))
    ).toBe(true);
  });

  it("rejects replayed and expired attempts and keeps secret material out of status", () => {
    expect(
      isAttemptUsable({ consumedAt: new Date("2026-01-01T00:00:00Z"), expiresAt: new Date("2026-01-01T01:00:00Z") }, new Date("2026-01-01T00:01:00Z"))
    ).toBe(false);
    expect(
      isAttemptUsable({ consumedAt: null, expiresAt: new Date("2025-12-31T23:59:59Z") }, new Date("2026-01-01T00:00:00Z"))
    ).toBe(false);
    expect(hashAttemptSecret("nonce-1")).not.toContain("nonce-1");
    expect(redactCoexistenceStatus({ status: "rejected", reason: "token=top-secret" })).toEqual({
      status: "rejected",
      reason: "Connection rejected",
    });
  });

  it("exposes only owner-safe attempt fields while retaining pending progress", () => {
    expect(
      redactAttemptForOwner({
        status: "awaiting_confirmation",
        reason: "token=top-secret",
        expiresAt: new Date("2026-01-01T01:00:00Z"),
        phoneNumberId: "pn_1",
      })
    ).toEqual({
      status: "awaiting_confirmation",
      reason: "Connection rejected",
      expiresAt: "2026-01-01T01:00:00.000Z",
      phoneNumberId: "pn_1",
    });
  });
});

describe("embedded signup exchange admission", () => {
  it("accepts the locked code-exchange asset shape", () => {
    expect(
      decodeEmbeddedSignupExchange({
        access_token: "candidate-token",
        waba_id: "waba_1",
        phone_number_id: "pn_1",
      })
    ).toEqual({ token: "candidate-token", wabaId: "waba_1", phoneNumberId: "pn_1" });
  });

  it("rejects malformed exchange data without returning token material", () => {
    expect(decodeEmbeddedSignupExchange({ access_token: "candidate-token", waba_id: "waba_1" })).toBeNull();
    expect(decodeEmbeddedSignupExchange({ access_token: 4, waba_id: "waba_1", phone_number_id: "pn_1" })).toBeNull();
  });
});
