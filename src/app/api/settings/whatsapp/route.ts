import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { getEnv, getWhatsappEmbeddedSignupAvailability, isWhatsappEmbeddedSignupEnabled } from "@/lib/env";
import { canPresentEmbeddedSignup, getCoexistenceStatus } from "@/server/whatsapp/coexistence";
import {
  getCredentialsByOrg,
  saveCredentials,
  tokenLast4,
} from "@/server/whatsapp/credentials";
import { subscribeAppToWaba, testConnection } from "@/server/whatsapp/connect";
import { getSyncStatus } from "@/server/whatsapp/smb-sync";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session) => {
  const creds = await getCredentialsByOrg(session.organizationId);
  const embeddedSignupEnabled = isWhatsappEmbeddedSignupEnabled();
  const canManageCoexistence = canPresentEmbeddedSignup({
    enabled: embeddedSignupEnabled,
    role: session.role,
  });
  const coexistenceSetup = session.role === "owner"
    ? getWhatsappEmbeddedSignupAvailability()
    : null;
  const coexistence = canManageCoexistence
    ? await getCoexistenceStatus(session.organizationId)
    : null;
  const embeddedSignup = canManageCoexistence
    ? {
        appId: getEnv().META_APP_ID!,
        configId: getEnv().META_EMBEDDED_SIGNUP_CONFIG_ID!,
      }
    : null;
  // Platform-managed mode: the operator owns the app-level webhook, so tenants
  // never need (nor should see) the webhook secret or the manual setup path.
  const platformManaged = embeddedSignupEnabled;
  // 020 (D7) — Estado de sincronización de contactos/historial (solo aplica a
  // coexistence; sin claim, ambas quedan null y no se muestra nada).
  const sync = await getSyncStatus(session.organizationId);
  if (!creds) {
    return Response.json({ connection: null, coexistence, embeddedSignup, coexistenceSetup, platformManaged, sync });
  }
  return Response.json({
    connection: {
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId,
      displayPhoneNumber: creds.displayPhoneNumber,
      verifiedName: creds.verifiedName,
      status: creds.status,
      tokenLast4: tokenLast4(creds.token),
    },
    coexistence,
    embeddedSignup,
    coexistenceSetup,
    platformManaged,
    sync,
  });
});

const putSchema = z.object({
  wabaId: z.string().trim().min(1),
  phoneNumberId: z.string().trim().min(1),
  token: z.string().trim().min(1),
});

/** Guarda la conexión: re-valida contra Meta, cifra y suscribe (FR-040). */
export const PUT = withAuth(async (session, req: Request) => {
  const body = await parseBody(req, putSchema);
  if (!body.ok) return body.response;

  const check = await testConnection(body.data.phoneNumberId, body.data.token);
  if (!check.ok) {
    const status = check.code === "meta_unavailable" ? 503 : 422;
    return apiError(status, check.code, check.message);
  }

  await saveCredentials({
    organizationId: session.organizationId,
    wabaId: body.data.wabaId,
    phoneNumberId: body.data.phoneNumberId,
    token: body.data.token,
    displayPhoneNumber: check.displayPhoneNumber,
    verifiedName: check.verifiedName,
  });

  // Best-effort: necesaria en modo directo. Si la WABA ya enruta a un override
  // (backend de agencia o cerebro externo), se respeta: re-suscribir lo borraría.
  await subscribeAppToWaba(body.data.wabaId, body.data.token);

  return Response.json({
    ok: true,
    displayPhoneNumber: check.displayPhoneNumber,
  });
});
