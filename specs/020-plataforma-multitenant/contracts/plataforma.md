# Contrato — Superficie de plataforma (`/api/platform/*` y `/admin`)

**Gate** (FR-030), evaluado en el servidor en CADA request: sesión de Better Auth
+ `user.email_verified = true` + correo (minúsculas, recortado) contenido en
`PLATFORM_ADMIN_EMAILS`. Si falla cualquiera de las tres: **`404` sin cuerpo**
(y `notFound()` en las páginas). Nunca 401/403: la superficie no existe para
quien no es super-admin.

Errores del super-admin con el sobre estándar `{ error: { code, message } }`.

---

## `GET /api/platform/organizations?q=&page=1`

`q` opcional (nombre de la organización o correo del owner, `ILIKE`), `page` ≥ 1,
50 por página, más nuevas primero.

```jsonc
{
  "page": 1,
  "pageSize": 50,
  "total": 132,
  "organizations": [
    {
      "id": "org_…",
      "name": "Dental Sonrisa",
      "ownerEmail": "dueña@ejemplo.com",          // null si no hay owner
      "createdAt": "2026-09-01T10:00:00.000Z",
      "suspendedAt": null,                          // o ISO
      "whatsapp": "connected",                      // connected | reconnect_required | none
      "coexistence": "active",                      // pending | awaiting_confirmation | active | rejected | revoked | disconnected | none
      "contacts": 412,
      "messages": 10233,
      "lastActivityAt": "2026-09-27T14:59:00.000Z"  // último mensaje; null si ninguno
    }
  ]
}
```

Los conteos excluyen el Laboratorio (`is_test`). Nunca incluye tokens, `last4`,
`waba_id` ni `phone_number_id`.

## `POST /api/platform/organizations/{id}/suspend`

Cuerpo `{ "reason": "texto opcional ≤ 300" }`. `200 { "ok": true, "suspendedAt": "…" }`.
Idempotente (suspender una suspendida no cambia `suspendedAt` ni duplica la
auditoría). Revoca las sesiones de los miembros. `404 not_found` si no existe.

## `POST /api/platform/organizations/{id}/reactivate`

`200 { "ok": true }`. Idempotente.

## `DELETE /api/platform/organizations/{id}`

Cuerpo `{ "confirmName": "Dental Sonrisa" }` — comparación exacta con el nombre
actual (sin normalizar).

| Caso | Respuesta |
|---|---|
| OK | `200 { "ok": true, "metaUnsubscribe": "ok" \| "failed" \| "skipped" }` |
| `confirmName` distinto | `422 confirmacion_invalida` |
| No existe | `404 not_found` |

## `POST /api/platform/impersonation`

Cuerpo `{ "organizationId": "org_…" }`. Cierra la suplantación activa previa del
mismo admin, crea la nueva y fija la cookie `vocero_imp` (httpOnly, `SameSite=Lax`,
`Secure` en producción, `Path=/`, 60 min) con su id opaco.

| Caso | Respuesta |
|---|---|
| OK | `200 { "ok": true, "redirect": "/inbox" }` |
| Organización con un miembro super-admin | `403 objetivo_protegido` |
| No existe | `404 not_found` |

## `DELETE /api/platform/impersonation`

Cierra la activa (`ended_reason = "salida"`), borra la cookie. `200 { "ok": true,
"redirect": "/admin" }`. Idempotente. **Única ruta de plataforma** alcanzable
también desde el aviso de la app (el admin sigue siendo admin).

## `GET /api/platform/audit?organizationId=&page=1`

```jsonc
{
  "events": [
    {
      "id": "pae_…",
      "action": "org_suspended",   // org_suspended | org_reactivated | org_deleted | impersonation_started | impersonation_ended
      "actorEmail": "operador@agencia.com",
      "organizationId": "org_…",
      "organizationName": "Dental Sonrisa",
      "metadata": { "reason": "…" },  // ended_reason, metaUnsubscribe, etc.
      "createdAt": "…"
    }
  ]
}
```

---

## Efecto sobre la sesión de la app (`requireSession`)

| Situación | `SessionContext` |
|---|---|
| Miembro de una organización activa | `{ userId, organizationId, role, impersonation: null }` |
| Miembro de una organización suspendida | lanza `403 org_suspendida` (API) / redirige a `/suspendida` (páginas) |
| Super-admin con cookie `vocero_imp` válida (misma sesión, sin fin, sin expirar) | `{ userId: <admin>, organizationId: <objetivo>, role: "owner", impersonation: { id, organizationName, suspended } }` |
| Super-admin sin suplantación | sin organización → páginas de la app redirigen a `/admin`; API `401` como hoy |
| Cookie inválida/expirada | se ignora; si la fila seguía abierta, se cierra con `expirada`/`sesion_terminada` |

## Acciones restringidas durante una suplantación (FR-034)

Con `session.impersonation` presente, estas rutas responden `403
suplantacion_restringida` en vez de ejecutar la mutación — el soporte puede
VER la organización pero no cambiar su identidad de equipo ni sus
credenciales de canal:

| Ruta | Motivo |
|---|---|
| `POST`/`DELETE /api/settings/team` | crear/borrar cuentas de equipo (FR-034 original) |
| `POST`/`DELETE /api/settings/api-key` | generar/rotar/revocar la clave del cerebro (FR-034 original) |
| `PUT /api/settings/whatsapp` | conexión manual por token: cambiaría a qué WABA/número está atado el negocio |
| `POST /api/settings/whatsapp/start` | inicia un intento nuevo de Embedded Signup (coexistence) |
| `POST /api/settings/whatsapp/complete` | confirma el intento y crea el claim con el token del negocio |
| `POST /api/settings/whatsapp/disconnect` | desconecta el canal del negocio |

`POST /api/settings/whatsapp/sync` (reintento manual de sincronización) NO
está restringida: reintentar una sincronización que ya falló es soporte
válido (T051) y no cambia ninguna credencial.
