import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { encryptSecret } from "@/lib/crypto";
import { getEnv } from "@/lib/env";
import { graphRequest } from "@/lib/meta/client";
import { subscribeAppToWaba, testConnection } from "@/server/whatsapp/connect";

const embeddedSignupExchangeSchema = z.object({
  access_token: z.string().min(1),
  waba_id: z.string().min(1),
  phone_number_id: z.string().min(1),
});

/**
 * The exchange boundary is deliberately closed until authenticated fixtures
 * establish another response shape. Callers receive token material only after
 * all assets needed to bind the candidate have been admitted.
 */
export function decodeEmbeddedSignupExchange(input: unknown): {
  token: string;
  wabaId: string;
  phoneNumberId: string;
} | null {
  const parsed = embeddedSignupExchangeSchema.safeParse(input);
  if (!parsed.success) return null;
  return {
    token: parsed.data.access_token,
    wabaId: parsed.data.waba_id,
    phoneNumberId: parsed.data.phone_number_id,
  };
}

export function canMutateCoexistence(role: string): boolean {
  return role === "owner";
}

/** The browser must not advertise an owner-only optional flow to members. */
export function canPresentEmbeddedSignup(input: { enabled: boolean; role: string }): boolean {
  return input.enabled && canMutateCoexistence(input.role);
}

export function hashAttemptSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function isAttemptUsable(
  attempt: { consumedAt: Date | null; expiresAt: Date },
  now = new Date()
): boolean {
  return attempt.consumedAt === null && attempt.expiresAt.getTime() > now.getTime();
}

export function redactCoexistenceStatus(input: {
  status: string;
  reason: string | null;
}): { status: string; reason: string | null } {
  return {
    status: input.status,
    reason: input.reason?.trim() ? "Connection rejected" : null,
  };
}

/** Shape safe for the owner settings screen; provider diagnostics stay server-side. */
export function redactAttemptForOwner(input: {
  status: string;
  reason: string | null;
  expiresAt: Date;
  phoneNumberId: string | null;
}): {
  status: string;
  reason: string | null;
  expiresAt: string;
  phoneNumberId: string | null;
} {
  return {
    status: input.status,
    reason: redactCoexistenceStatus(input).reason,
    expiresAt: input.expiresAt.toISOString(),
    phoneNumberId: input.phoneNumberId,
  };
}

const ATTEMPT_TTL_MS = 10 * 60 * 1000;

export type CoexistenceAttemptResult = {
  attemptId: string;
  state: string;
  nonce: string;
  expiresAt: string;
};

/** Creates a single-use state/nonce pair bound to the current owner and tenant. */
export async function createCoexistenceAttempt(input: {
  organizationId: string;
  ownerUserId: string;
  now?: Date;
}): Promise<CoexistenceAttemptResult> {
  const now = input.now ?? new Date();
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");
  const expiresAt = new Date(now.getTime() + ATTEMPT_TTL_MS);
  const id = newId("coexistenceAttempt");
  await getDb().insert(schema.whatsappCoexistenceAttempt).values({
    id,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    stateHash: hashAttemptSecret(state),
    nonceHash: hashAttemptSecret(nonce),
    expiresAt,
  });
  return { attemptId: id, state, nonce, expiresAt: expiresAt.toISOString() };
}

/** Returns the newest organization-scoped status without exposing encrypted data. */
export async function getCoexistenceStatus(organizationId: string) {
  const rows = await getDb()
    .select()
    .from(schema.whatsappCoexistenceAttempt)
    .where(eq(schema.whatsappCoexistenceAttempt.organizationId, organizationId))
    .orderBy(desc(schema.whatsappCoexistenceAttempt.createdAt))
    .limit(1);
  const row = rows[0];
  return row ? redactAttemptForOwner(row) : null;
}

const codeExchangeResponse = z.object({ access_token: z.string().min(1) });

/**
 * Exchanges the short-lived Embedded Signup code only on the server. The
 * response is deliberately admitted through the locked exchange decoder.
 */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string | null> {
  const env = getEnv();
  if (!env.META_APP_ID || !env.META_APP_SECRET) return null;
  const response = await graphRequest<unknown>("oauth/access_token", {
    method: "POST",
    token: `${env.META_APP_ID}|${env.META_APP_SECRET}`,
    body: { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, code },
  });
  const parsed = codeExchangeResponse.safeParse(response);
  return parsed.success ? parsed.data.access_token : null;
}

/**
 * Verifies a candidate against Meta before inserting an encrypted pending
 * claim. Existing active credentials are intentionally untouched here.
 */
export async function completeCoexistenceAttempt(input: {
  organizationId: string;
  ownerUserId: string;
  state: string;
  nonce: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<"accepted" | "invalid_attempt" | "conflict" | "verification_failed"> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.whatsappCoexistenceAttempt)
    .where(
      and(
        eq(schema.whatsappCoexistenceAttempt.organizationId, input.organizationId),
        eq(schema.whatsappCoexistenceAttempt.ownerUserId, input.ownerUserId),
        eq(schema.whatsappCoexistenceAttempt.stateHash, hashAttemptSecret(input.state))
      )
    )
    .limit(1);
  const attempt = rows[0];
  if (!attempt || attempt.nonceHash !== hashAttemptSecret(input.nonce) || !isAttemptUsable(attempt)) {
    return "invalid_attempt";
  }
  const token = await exchangeEmbeddedSignupCode(input.code).catch(() => null);
  if (!token) return "verification_failed";
  const check = await testConnection(input.phoneNumberId, token);
  if (!check.ok || (await subscribeAppToWaba(input.wabaId, token)) === "failed") {
    return "verification_failed";
  }
  const encrypted = encryptSecret(token);
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.whatsappCoexistenceClaim).values({
        id: newId("coexistenceClaim"),
        organizationId: input.organizationId,
        attemptId: attempt.id,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        tokenCipher: encrypted.cipher,
        tokenIv: encrypted.iv,
        tokenTag: encrypted.tag,
      });
      await tx
        .update(schema.whatsappCoexistenceAttempt)
        .set({
          consumedAt: new Date(),
          status: "awaiting_confirmation",
          phoneNumberId: input.phoneNumberId,
          updatedAt: new Date(),
        })
        .where(eq(schema.whatsappCoexistenceAttempt.id, attempt.id));
    });
    return "accepted";
  } catch {
    return "conflict";
  }
}

/** Owner-triggered disconnect invalidates active send credentials and pending claims. */
export async function disconnectCoexistence(organizationId: string): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.metaCredentials).where(eq(schema.metaCredentials.organizationId, organizationId));
    await tx
      .update(schema.whatsappCoexistenceClaim)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(schema.whatsappCoexistenceClaim.organizationId, organizationId));
    await tx
      .update(schema.whatsappCoexistenceAttempt)
      .set({ status: "disconnected", updatedAt: new Date() })
      .where(eq(schema.whatsappCoexistenceAttempt.organizationId, organizationId));
  });
}

/** A terminal coexistence claim must never be bypassed by later manual credentials. */
export async function isCoexistenceSendBlocked(organizationId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: schema.whatsappCoexistenceClaim.id })
    .from(schema.whatsappCoexistenceClaim)
    .where(
      and(
        eq(schema.whatsappCoexistenceClaim.organizationId, organizationId),
        inArray(schema.whatsappCoexistenceClaim.status, ["rejected", "revoked", "disconnected"])
      )
    )
    .limit(1);
  return Boolean(rows[0]);
}
