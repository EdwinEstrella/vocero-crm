import { z } from "zod";
import { withPlatformAdmin } from "@/lib/api";
import { listOrganizations } from "@/server/platform/organizations";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

/** 020 (D3/FR-030) — Lista de organizaciones del panel de super-admin. */
export const GET = withPlatformAdmin(async (_admin, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
  });
  const { q, page } = parsed.success ? parsed.data : {};
  const result = await listOrganizations({ q, page });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
});
