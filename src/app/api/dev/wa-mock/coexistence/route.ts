import { z } from "zod";
import { apiError, parseBody } from "@/lib/api";
import { mockGuard } from "@/lib/dev-guard";
import {
  buildCoexistenceHistoryPayload,
  buildCoexistenceLifecyclePayload,
  deliverToWebhook,
} from "@/server/dev/wa-mock-inbound";
import { getCredentialsByPhoneNumberId } from "@/server/whatsapp/credentials";

export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("lifecycle"),
    phoneNumberId: z.string().min(1),
    event: z.enum(["confirmed", "rejected", "revoked", "disconnected"]),
  }),
  z.object({
    kind: z.literal("history"),
    phoneNumberId: z.string().min(1),
    consentedAt: z.string().datetime(),
    messages: z.array(z.record(z.unknown())).min(1),
    contacts: z.array(z.record(z.unknown())).optional(),
  }),
]);

/**
 * Sends an explicitly development-only signed payload through the real
 * webhook. It cannot create claims or bypass authenticated fixture admission.
 */
export async function POST(req: Request) {
  const guard = mockGuard();
  if (guard) return guard;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const credentials = await getCredentialsByPhoneNumberId(body.data.phoneNumberId);
  const wabaId = credentials?.wabaId ?? "WABA-MOCK";
  const payload = body.data.kind === "lifecycle"
    ? buildCoexistenceLifecyclePayload({ ...body.data, wabaId })
    : buildCoexistenceHistoryPayload({ ...body.data, wabaId });
  const response = await deliverToWebhook(payload);
  if (!response.ok) return apiError(502, "webhook_error", `El webhook respondió ${response.status}`);
  return Response.json({ delivered: true, fixtureAdmission: "development-only" });
}
