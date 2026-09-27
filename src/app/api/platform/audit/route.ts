import { z } from "zod";
import { withPlatformAdmin } from "@/lib/api";
import { listPlatformEvents } from "@/server/platform/audit";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  organizationId: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).optional(),
});

export const GET = withPlatformAdmin(async (_admin, req: Request) => {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    organizationId: url.searchParams.get("organizationId") ?? undefined,
    page: url.searchParams.get("page") ?? undefined,
  });
  const { organizationId, page } = parsed.success ? parsed.data : {};
  const result = await listPlatformEvents({ organizationId, page });
  return Response.json(result, { headers: { "cache-control": "no-store" } });
});
