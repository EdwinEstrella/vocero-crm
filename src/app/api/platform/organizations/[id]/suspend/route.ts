import { z } from "zod";
import { apiError, parseOptionalBody, withPlatformAdmin } from "@/lib/api";
import { OrganizationNotFoundError, suspendOrganization } from "@/server/platform/suspension";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ reason: z.string().trim().max(300).optional() });

/** 020 (US5/FR-036) — Idempotente: suspender una ya suspendida no cambia `suspendedAt`. */
export const POST = withPlatformAdmin(async (admin, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseOptionalBody(req, bodySchema);
  if (!body.ok) return body.response;

  try {
    const { suspendedAt } = await suspendOrganization(id, body.data.reason, admin);
    return Response.json(
      { ok: true, suspendedAt: suspendedAt.toISOString() },
      { headers: { "cache-control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof OrganizationNotFoundError) {
      return apiError(404, "not_found", "La organización no existe");
    }
    throw err;
  }
});
