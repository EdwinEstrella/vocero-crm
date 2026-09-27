import { apiError, withPlatformAdmin } from "@/lib/api";
import { OrganizationNotFoundError, reactivateOrganization } from "@/server/platform/suspension";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 020 (US5/FR-036) — Idempotente. */
export const POST = withPlatformAdmin(async (admin, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  try {
    await reactivateOrganization(id, admin);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof OrganizationNotFoundError) {
      return apiError(404, "not_found", "La organización no existe");
    }
    throw err;
  }
});
