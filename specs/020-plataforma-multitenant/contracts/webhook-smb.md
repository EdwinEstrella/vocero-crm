# Contrato — Webhook de WhatsApp (campos de coexistence) y petición `smb_app_data`

Fuente: Meta for Developers, "Onboard WhatsApp Business app users" y la
referencia de `account_update` (URLs en `plan.md`, R1–R3). Las formas de abajo
son las documentadas por Meta; los fixtures de wa-mock DEBEN reproducirlas.

Enrutamiento a organización:

| Campo | Llave de enrutamiento | Tabla |
|---|---|---|
| `messages`, `smb_message_echoes`, `history`, `smb_app_state_sync` | `value.metadata.phone_number_id` | `meta_credentials` o, para coexistence, `whatsapp_coexistence_claim` |
| `message_template_status_update` | `entry.id` (WABA) | como hoy (`template-events.ts`) |
| `account_update` | `entry.id` o `value.waba_info.waba_id` (NO trae `phone_number_id`) | `whatsapp_coexistence_claim.waba_id` |

Número/WABA desconocido → log + descarte + `200`. Organización suspendida → todo
excepto `account_update` se descarta con log (FR-041).

---

## Salida: `POST {GRAPH}/{phone_number_id}/smb_app_data`

Con el token del negocio (el del claim activo). Dos llamadas, en este orden, una
vez cada una:

```json
{ "messaging_product": "whatsapp", "sync_type": "smb_app_state_sync" }
```

```json
{ "messaging_product": "whatsapp", "sync_type": "history" }
```

Respuesta de éxito:

```json
{ "messaging_product": "whatsapp", "request_id": "<REQUEST_ID>" }
```

Reglas de Meta: 24 horas desde el alta para sincronizar (si no, hay que
desconectar y repetir el flujo); cada paso "can only be performed once".

Reglas de Vocero (FR-043/044):

1. Reclamar `INSERT … ON CONFLICT DO NOTHING` sobre UNIQUE
   (`organization_id`, `phone_number_id`, `sync_type`) con estado `pending`; si
   no se insertó, no se llama a Meta.
2. Llamar fuera de toda transacción. `request_id` → `requested`. Error de Meta o
   timeout → `failed` con motivo redactado (sin token ni payload crudo).
3. `history` solo se pide si `smb_app_state_sync` quedó `requested`.
4. El reintento manual del owner solo aplica a filas `failed` con
   `window_expires_at > now()`; pasa la fila a `pending` con un `UPDATE … WHERE
   status = 'failed'` condicional (dos clics no duplican).
5. Al vencer la ventana, las filas `pending`/`failed` se muestran como
   `expired` (calculado o marcado por el worker).

El mock de Graph (`/api/dev/wa-mock/graph/[...path]`) aprende
`POST {pn}/smb_app_data`: valida el cuerpo, responde `request_id` y rechaza con
`400` cuando el `phone_number_id` termina en `-fail` (camino infeliz).

---

## Entrada: `smb_app_state_sync`

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "<WABA_ID>",
    "changes": [{
      "field": "smb_app_state_sync",
      "value": {
        "messaging_product": "whatsapp",
        "metadata": { "display_phone_number": "<BUSINESS_PHONE_NUMBER>", "phone_number_id": "<BUSINESS_PHONE_NUMBER_ID>" },
        "state_sync": [{
          "type": "contact",
          "contact": { "full_name": "<CONTACT_FULL_NAME>", "first_name": "<CONTACT_FIRST_NAME>", "phone_number": "<CONTACT_PHONE_NUMBER>" },
          "action": "add",
          "metadata": { "timestamp": "<WEBHOOK_TIMESTAMP>" }
        }]
      }
    }]
  }]
}
```

Por cada entrada con `type = "contact"`:

| `action` | Efecto |
|---|---|
| `add` (alta o edición según Meta) / `edit` (defensivo) | Normalizar `phone_number` (`identity.ts`, 521→52). Sin teléfono → ignorar. Upsert por (`organization_id`, `whatsapp`, `wa_identity`). Nombre = `full_name` ‖ `first_name`; se escribe solo si `name_source` ≠ `manual`, y queda `name_source = "libreta"`. Suma 1 a `items_received` de la petición `smb_app_state_sync`. |
| `remove` | **Sin efecto** sobre el contacto del CRM (E2). Log con conteo. |
| otro / `type` ≠ `contact` | Ignorar sin error. |

Idempotencia: reentregar la misma entrada produce el mismo contacto (UNIQUE de
contacto) y el mismo nombre; `items_received` es informativo, no llave.

La entrega pasa por el buzón durable de coexistence
(`whatsapp_coexistence_delivery`, `kind = "state_sync"`), con `event_key` =
sha256 de (organización, tipo, número, timestamp + teléfonos ordenados).

---

## Entrada: `history`

Con hilos:

```json
{
  "field": "history",
  "value": {
    "messaging_product": "whatsapp",
    "metadata": { "display_phone_number": "<BUSINESS_PHONE_NUMBER>", "phone_number_id": "<BUSINESS_PHONE_NUMBER_ID>" },
    "history": [{
      "metadata": { "phase": "<PHASE>", "chunk_order": "<CHUNK_ORDER>", "progress": "<PROGRESS>" },
      "threads": [{
        "id": "<WHATSAPP_USER_PHONE_NUMBER>",
        "messages": [{
          "from": "<BUSINESS_OR_WHATSAPP_USER_PHONE_NUMBER>",
          "to": "<WHATSAPP_USER_PHONE_NUMBER>",
          "id": "<WHATSAPP_MESSAGE_ID>",
          "timestamp": "<DEVICE_TIMESTAMP>",
          "type": "<MESSAGE_TYPE>",
          "<MESSAGE_TYPE>": "<MESSAGE_CONTENTS>",
          "history_context": { "status": "<MESSAGE_STATUS>" }
        }]
      }]
    }]
  }
}
```

- Contacto del hilo = `threads[].id` normalizado.
- Dirección: `from` normalizado = número del negocio (`display_phone_number`
  normalizado) → `out`; si no → `in`.
- Dedup por `wa_message_id` UNIQUE (como hoy); `import_source = "history"`; sin
  agente, sin SSE de "nuevo mensaje" por cada uno (un único evento de refresco al
  terminar el lote).
- `progress` (0–100) se guarda en la petición `history` (`progress`).

Declinado por el negocio:

```json
{ "history": [{ "errors": [{ "code": 2593109, "title": "History sync is turned off by the business from the WhatsApp Business App" }] }] }
```

→ petición `history` pasa a `declined`; no se reintenta.

---

## Entrada: `account_update`

```json
{
  "field": "account_update",
  "value": { "event": "PARTNER_REMOVED", "waba_info": { "waba_id": "<WABA_ID>", "owner_business_id": "<BUSINESS_ID>" } }
}
```

| `value.event` | Evento del ciclo de vida (`lifecycle.ts`) |
|---|---|
| `PARTNER_ADDED`, `PARTNER_APP_INSTALLED` | `confirmed` |
| `PARTNER_REMOVED`, `PARTNER_APP_UNINSTALLED` | `revoked` |
| `ACCOUNT_OFFBOARDED`, `ACCOUNT_DELETED` | `disconnected` |
| `ACCOUNT_RECONNECTED` y los demás | ignorar con log (ver NEEDS CLARIFICATION R3 en el plan) |

`nextCoexistenceStatus` sigue aplicando solo transiciones hacia adelante; los
estados terminales no se reabren.
