import type { WebhookValue } from "@/server/inbox/webhook";
import { getCredentialsByWabaId } from "@/server/whatsapp/credentials";
import { isOrganizationSuspended } from "@/server/platform/suspension";
import { applyTemplateStatusEvent } from "@/server/whatsapp/templates";

/**
 * Evento `message_template_status_update` (llega a nivel WABA: se enruta por
 * entry.id). Idempotente: re-aplicar el mismo estado no tiene efectos.
 * FR-041: organización suspendida → descarte con log, tras resolverla por WABA.
 */
export async function processTemplateStatusValue(
  wabaId: string | null,
  value: WebhookValue
): Promise<void> {
  if (wabaId) {
    const creds = await getCredentialsByWabaId(wabaId);
    if (creds && (await isOrganizationSuspended(creds.organizationId))) {
      console.warn(
        `[webhook] org suspendida (${creds.organizationId}): actualización de plantilla descartada`
      );
      return;
    }
  }
  await applyTemplateStatusEvent(wabaId, value);
}
