import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { apiError, parseBody } from "@/lib/api";
import { mockGuard } from "@/lib/dev-guard";
import {
  buildCoexistenceHistoryPayload,
  buildCoexistenceLifecyclePayload,
  buildStateSyncPayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lifecycle"),
    phoneNumberId: z.string().min(1),
    event: z.string().min(1),
  }),
  z.object({
    kind: z.literal("state_sync"),
    phoneNumberId: z.string().min(1),
    entries: z
      .array(
        z.object({
          action: z.enum(["add", "edit", "remove"]),
          fullName: z.string().optional(),
          firstName: z.string().optional(),
          phoneNumber: z.string().optional(),
        })
      )
      .min(1),
  }),
  z.object({
    kind: z.literal("history"),
    phoneNumberId: z.string().min(1),
    threads: z
      .array(z.object({ id: z.string().min(1), messages: z.array(z.record(z.unknown())) }))
      .optional(),
    phase: z.string().optional(),
    progress: z.number().optional(),
    declined: z.boolean().optional(),
  }),
]);

/**
 * `account_update` is routed by WABA in production, so before any real
 * credential exists the harness must resolve it from the PENDING claim
 * (not `metaCredentials`, which only appears once a claim goes `active`).
 */
async function resolveWabaId(phoneNumberId: string): Promise<string> {
  const claims = await getDb()
    .select({ wabaId: schema.whatsappCoexistenceClaim.wabaId })
    .from(schema.whatsappCoexistenceClaim)
    .where(eq(schema.whatsappCoexistenceClaim.phoneNumberId, phoneNumberId))
    .limit(1);
  if (claims[0]) return claims[0].wabaId;
  const credentials = await getCredentialsByPhoneNumberId(phoneNumberId);
  return credentials?.wabaId ?? "WABA-MOCK";
}

/**
 * Sends an explicitly development-only signed payload through the real
 * webhook. It cannot create claims or bypass authenticated fixture admission.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const wabaId = await resolveWabaId(body.data.phoneNumberId);
  const payload =
    body.data.kind === "lifecycle"
      ? buildCoexistenceLifecyclePayload({ wabaId, event: body.data.event })
      : body.data.kind === "state_sync"
        ? buildStateSyncPayload({ wabaId, phoneNumberId: body.data.phoneNumberId, entries: body.data.entries })
        : buildCoexistenceHistoryPayload({
            wabaId,
            phoneNumberId: body.data.phoneNumberId,
            threads: body.data.threads,
            phase: body.data.phase,
            progress: body.data.progress,
            declined: body.data.declined,
          });
  const response = await deliverToWebhook(payload);
  if (!response.ok) return apiError(502, "webhook_error", `El webhook respondió ${response.status}`);
  return Response.json({ delivered: true, fixtureAdmission: "development-only" });
}
