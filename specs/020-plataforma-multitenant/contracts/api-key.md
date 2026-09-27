# Contrato — Clave de API por organización (`/api/settings/api-key` y `/api/bot/*`)

Errores con el sobre estándar del proyecto: `{ error: { code, message } }`.

---

## Ajustes (sesión, `withAuth`, alcance por organización)

Solo el rol `owner` muta. Durante una suplantación, las mutaciones responden
`403 suplantacion_restringida` (FR-034).

### `GET /api/settings/api-key`

```jsonc
// Sin clave activa
{ "apiKey": null }

// Con clave activa — NUNCA la clave completa
{
  "apiKey": {
    "id": "bak_…",
    "last4": "Q9xZ",
    "createdAt": "2026-09-27T15:04:05.000Z",
    "lastUsedAt": "2026-09-27T16:10:00.000Z"   // o null
  }
}
```

### `POST /api/settings/api-key`

Genera (si no hay activa) o **rota** (si la hay: revoca la anterior en la misma
transacción). Sin cuerpo.

```jsonc
// 201 — la única respuesta que contiene la clave completa
{
  "apiKey": { "id": "bak_…", "last4": "Q9xZ", "createdAt": "…", "lastUsedAt": null },
  "secret": "vk_3m9…Q9xZ"     // 43 chars base64url tras el prefijo; no se vuelve a mostrar
}
```

| Caso | Respuesta |
|---|---|
| Rol distinto de `owner` | `403 forbidden` |
| Suplantación activa | `403 suplantacion_restringida` |

La respuesta lleva `Cache-Control: no-store`. El secreto jamás se escribe en logs.

### `DELETE /api/settings/api-key`

Revoca la clave activa. `200 { "ok": true }`; sin clave activa, `200` igual
(idempotente). Mismas reglas de rol y suplantación.

---

## `/api/bot/*` (servicio, sin sesión)

Header `X-API-Key: vk_…`. Resolución:

1. `sha256(hex)` del valor recibido → búsqueda por `bot_api_key.key_hash` con
   `revoked_at IS NULL`.
2. Sin coincidencia → `401 unauthorized` (y el limitador de fallos por IP de
   hoy: 30/min → `429 rate_limited`).
3. Organización suspendida → `403 org_suspendida`.
4. Coincidencia → la organización de la fila es EL tenant del request. Se
   actualiza `last_used_at` (como mucho una escritura por minuto por clave), se
   marca "visto" para esa organización y se aplica el presupuesto
   `bot-api:{organizationId}` (1200/min).

`BOT_API_KEY` (entorno) ya no participa: un valor igual a ella se trata como
cualquier clave desconocida (401).

Las diez rutas existentes (`bookings`, `typing`, `availability`, `reset`,
`handoff`, `profile`, `ficha`, `context`, `messages`, `media/[mediaId]`) conservan
su forma de request/response; solo cambia de dónde sale `organizationId`. Un id de
otra organización responde 404, como hoy.

### Nota de migración (para el `.env.example` y la guía)

> Desde la 020, `BOT_API_KEY` ya no se acepta. Entra como owner a Ajustes → API,
> genera la clave de tu organización y cámbiala en tu cerebro externo. Si el
> servidor arranca con `BOT_API_KEY` definida, lo avisa en el log.
