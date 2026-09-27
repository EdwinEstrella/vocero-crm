import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import { deleteOrganization } from "@/server/platform/delete";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const bodySchema = z.object({ confirmName: z.string() });

/** 020 (US6/FR-037) — Borrado irreversible; exige el nombre EXACTO. */
export const DELETE = withPlatformAdmin(async (admin, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const result = await deleteOrganization(id, body.data.confirmName, admin);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return apiError(404, "not_found", "La organización no existe");
    }
    return apiError(
      422,
      "confirmacion_invalida",
      "El nombre no coincide con el de la organización"
    );
  }
  return Response.json(
    { ok: true, metaUnsubscribe: result.metaUnsubscribe },
    { headers: { "cache-control": "no-store" } }
  );
});
