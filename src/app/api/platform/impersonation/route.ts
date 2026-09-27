import { cookies } from "next/headers";
import { z } from "zod";
import { apiError, parseBody, withPlatformAdmin } from "@/lib/api";
import {
  IMPERSONATION_COOKIE,
  endImpersonation,
  startImpersonation,
} from "@/server/platform/impersonation";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ organizationId: z.string().min(1) });

/** 020 (US7/FR-031) — Entrar como soporte a una organización. */
export const POST = withPlatformAdmin(async (admin, req: Request) => {
  const body = await parseBody(req, bodySchema);
  if (!body.ok) return body.response;

  const result = await startImpersonation(admin, body.data.organizationId);
  if (!result.ok) {
    if (result.reason === "not_found") {
      return apiError(404, "not_found", "La organización no existe");
    }
    return apiError(
      403,
      "objetivo_protegido",
      "No se puede suplantar una organización con un super-admin como miembro"
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, result.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
  return Response.json(
    { ok: true, redirect: "/inbox" },
    { headers: { "cache-control": "no-store" } }
  );
});

/**
 * "Salir": termina la suplantación activa del admin. Alcanzable también
 * desde dentro de la app (el aviso fijo), no solo desde `/admin` — el admin
 * sigue siendo admin.
 */
export const DELETE = withPlatformAdmin(async (admin) => {
  await endImpersonation(admin, "salida");
  const cookieStore = await cookies();
  cookieStore.delete(IMPERSONATION_COOKIE);
  return Response.json(
    { ok: true, redirect: "/admin" },
    { headers: { "cache-control": "no-store" } }
  );
});
