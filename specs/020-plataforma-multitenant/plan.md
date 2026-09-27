# Implementation Plan: Plataforma multi-tenant

**Branch**: `020-plataforma-multitenant` | **Date**: 2026-09-27 | **Spec**: [spec.md](./spec.md)

**Carril declarado**: **ciclo completo** (Principio VI) — migra el modelo de
datos (una columna en `organization`, cuatro tablas nuevas) y cambia dos
contratos publicados (`/api/bot/*`, webhook de WhatsApp). Requiere la enmienda
constitucional **2.0.0**, incluida en el mismo cambio.

## Summary

Cuatro frentes, en este orden de dependencia:

1. **Quitar la organización única** del código: alta pública que crea una
   organización por registro, sesión que rechaza organizaciones suspendidas,
   marca sin sesión neutral, y fin de todo `from(organization).limit(1)`.
2. **Claves de API por organización** para `/api/bot/*` (sha256, una activa por
   organización, presupuesto y "visto" por organización). `BOT_API_KEY` deja de
   aceptarse.
3. **Plataforma**: gate de super-admin por `PLATFORM_ADMIN_EMAILS` + correo
   verificado por script del operador; panel `/admin` para listar, suspender,
   borrar y suplantar, con auditoría.
4. **Webhook y sincronización**: decodificar `history` y `account_update` con la
   forma real de Meta, procesar `smb_app_state_sync`, y pedir una sola vez la
   sincronización de contactos e historial al activarse el claim.

## Technical Context

**Language/Version**: TypeScript estricto (`strict` + `noUncheckedIndexedAccess`), Node 22

**Primary Dependencies**: **ninguna nueva**. Better Auth (ya presente; sin plugin
`admin`, ver R5), Drizzle, Zod, `node:crypto` (sha256, `randomBytes`), `graphRequest`
de `src/lib/meta/client.ts`.

**Storage**: PostgreSQL + Drizzle. Migración `drizzle/0016_plataforma_multitenant.sql`
generada con `pnpm db:generate`, aditiva y re-ejecutable.

**Testing**: Vitest para lo puro y los gates (resolución de clave, gate de
super-admin, gate de suspensión, decodificadores de Meta, reglas de libreta,
test estático anti-`limit(1)`) + `pnpm test:e2e` extendido con dos
organizaciones, el panel y la sincronización.

**Target Platform**: el mismo monolito; sin procesos nuevos. El trabajo de
sincronización corre en el worker de coexistence existente
(`drainCoexistenceDeliveries`, arrancado en `src/instrumentation-node.ts`).

**Constraints**: `organization_id` vía `scoped()`; secretos (claves, tokens)
nunca al cliente ni a logs; `is_test` sin efectos externos; cada llamada a Meta
fuera de transacción y best-effort donde la spec lo dice.

**Scale/Scope**: decenas a pocos cientos de organizaciones por despliegue. La
lista del panel agrega conteos por organización con `GROUP BY` sobre índices
org-first existentes; paginada a 50.

## Research (Fase 0)

- **R1 — `smb_app_data` (sincronización)**. Fuente:
  <https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users>
  (versión nueva:
  <https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/>),
  consultada 2026-09-27. Confirmado: `POST /<BUSINESS_PHONE_NUMBER_ID>/smb_app_data`
  con `{"messaging_product":"whatsapp","sync_type":"smb_app_state_sync"}` y
  luego `{"messaging_product":"whatsapp","sync_type":"history"}`; respuesta
  `{"messaging_product":"whatsapp","request_id":"…"}`; "you have 24 hours to
  synchronize … otherwise they must be offboarded"; cada paso "can only be
  performed once". El orden documentado es contactos → historial, tras el alta
  sin registrar el número (ya registrado en la app). → FR-043/044.
- **R2 — Formas de `smb_app_state_sync` y `history`** (misma fuente). `state_sync[]`
  con `type: "contact"`, `contact.{full_name, first_name, phone_number}`,
  `action` ∈ {`add` (alta o edición), `remove`}, `metadata.timestamp`.
  `history[]` con `metadata.{phase, chunk_order, progress}` y
  `threads[].{id, messages[]}`; mensajes con `from`, `to`, `id`, `timestamp`,
  `type`, `history_context.status`. Declinado: `history[].errors[]` con `code:
  2593109`. **Hallazgo**: el decodificador actual
  (`src/server/whatsapp/lifecycle.ts:104-146`) espera `value.messages` +
  `value.coexistence.consented_at`, una forma derivada de fixtures que Meta no
  envía; con la forma real, todo `history` se descartaría. `ingestHistoricalMessages`
  (`src/server/inbox/ingest.ts:329-357`) además marca todo como `direction: "in"`.
  Se reemplazan (FR-042).
- **R3 — `account_update`**. Fuente:
  <https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/reference/account_update>,
  consultada 2026-09-27. `value.event` ∈ {`PARTNER_ADDED`, `PARTNER_APP_INSTALLED`,
  `PARTNER_APP_UNINSTALLED`, `PARTNER_REMOVED`, `ACCOUNT_OFFBOARDED`,
  `ACCOUNT_RECONNECTED`, `ACCOUNT_DELETED`, …} con `waba_info.waba_id`; **no trae
  `metadata.phone_number_id`**. **Hallazgo**: el decodificador actual exige
  `metadata.phone_number_id` y `value.coexistence.event` (forma de fixture), así
  que un `account_update` real nunca activa un claim. Se enruta por WABA
  (`whatsapp_coexistence_claim.waba_id`) con la tabla de `contracts/webhook-smb.md`.
  **Resuelto (T040, decisión del dueño/orquestador, 2026-09-27)**: sin una
  entrega real observable de la App de Meta a la mano, se fija la regla y se
  documenta para reabrirla si un payload real la contradice. Un
  `account_update` con `value.event` en {`PARTNER_ADDED`, `PARTNER_APP_INSTALLED`}
  confirma un claim `awaiting_confirmation` SOLO cuando `value.waba_info.waba_id`
  coincide con el `waba_id` de ese claim — el enrutamiento por WABA ya lo
  garantiza (los claims son por organización: una WABA ajena nunca confirma
  el claim de otra organización). `ACCOUNT_RECONNECTED` es no-op para el
  estado del claim (se loguea, sin transición: un terminal sigue sin
  reabrirse). `PARTNER_REMOVED` / `PARTNER_APP_UNINSTALLED` → `revoked` (la
  semántica de revocación ya existente: se borran las credenciales usables).
  Cualquier otro evento no mapeado se trata igual que `ACCOUNT_RECONNECTED`
  (no-op logueado) — nunca se infiere una transición de un evento nuevo de
  Meta. Implementado en `decodeAccountUpdate`
  (`src/server/whatsapp/lifecycle.ts`).
- **R4 — Alcance de la ventana de 24 h**. Se ancla a `activated_at` del claim
  (momento en que pasa a `active`), no al alta de la organización. Si Meta la
  ancla antes (fin del flujo Embedded Signup), la ventana real es menor: por eso
  la petición sale en el mismo tick del worker que activa el claim, y la UI
  muestra la hora límite.
- **R5 — ¿Plugin `admin` de Better Auth para suplantar?** Descartado: suplanta
  **usuarios** (la sesión pasa a ser del owner, y lo que haga el soporte queda a
  nombre del owner), exige un rol en `user` editable desde la app y no conoce la
  organización. La spec pide auditar al admin, no ser el owner (US7-4). Se
  implementa una suplantación de **organización** propia (E6) sobre la sesión
  del admin.
- **R6 — Correo verificado sin email**. `requireEmailVerification: false` y sin
  servicio de correo (Principio II): Better Auth deja `email_verified = false`
  en todo alta. El script del operador lo pone en `true` (E4). El registro
  público de un correo reservado se bloquea en `hooks.before` (`/sign-up/email`).
- **R7 — Cascada del borrado**. Las 28 columnas `organization_id` de
  `src/lib/db/schema.ts` referencian `organization.id` con `onDelete: "cascade"`
  (verificado: 28/28). La auditoría de plataforma es la excepción deliberada
  (sin FK). Archivos: `MEDIA_DIR/{organizationId}` (patrón de
  `src/server/branding.ts` y los adjuntos).
- **R8 — Estado global en memoria**. `src/server/bot/status.ts:40-55` (último
  visto), el cubo `"bot-api"` de `src/server/bot/auth.ts` y la caché
  `cachedOrgId` son globales de proceso. Las cachés de Google/Zoom
  (`src/server/agenda/connectors/*-credentials.ts`) se auditan en T012.

## Data Model (Fase 1)

Migración `0016_plataforma_multitenant.sql` (aditiva):

| Tabla / columna | Campos | Índices / reglas |
|---|---|---|
| `organization` (+) | `suspended_at timestamp null`, `suspended_reason text null` | — |
| `platform_audit_event` (NUEVA, prefijo `pae`) | `id`, `actor_user_id text` (sin FK), `actor_email text`, `action text` (enum: `org_suspended`, `org_reactivated`, `org_deleted`, `impersonation_started`, `impersonation_ended`), `organization_id text` (sin FK), `organization_name text`, `metadata jsonb`, `created_at` | `(organization_id, created_at)`, `(created_at)` |
| `platform_impersonation` (NUEVA, `imp`) | `id`, `admin_user_id text` FK `user` cascade, `organization_id text` (sin FK: el fin se registra aunque la org se borre), `session_id text`, `started_at`, `expires_at`, `ended_at null`, `ended_reason text null` (`salida`, `expirada`, `sesion_terminada`, `reemplazada`, `org_borrada`) | parcial UNIQUE `(admin_user_id) WHERE ended_at IS NULL` |
| `bot_api_key` (NUEVA, `bak`) | `id`, `organization_id` FK cascade NOT NULL, `key_hash text`, `last4 text`, `created_by_user_id text`, `created_at`, `last_used_at null`, `revoked_at null` | UNIQUE `(key_hash)`; parcial UNIQUE `(organization_id) WHERE revoked_at IS NULL` |
| `whatsapp_smb_sync_request` (NUEVA, `wss`) | `id`, `organization_id` FK cascade NOT NULL, `phone_number_id`, `sync_type` (`smb_app_state_sync` \| `history`), `status` (`pending`, `requested`, `failed`, `declined`, `expired`), `request_id null`, `error null` (redactado), `items_received int default 0`, `progress int null`, `window_expires_at`, `created_at`, `updated_at` | UNIQUE `(organization_id, phone_number_id, sync_type)` |
| `whatsapp_coexistence_claim` (+) | `activated_at timestamp null` | — |
| `contact.name_source` | enum TS gana `libreta` (columna `text`, sin CHECK: no requiere DDL) | — |

`src/lib/db/ids.ts`: prefijos `platformAuditEvent: "pae"`, `impersonation: "imp"`,
`botApiKey: "bak"`, `smbSyncRequest: "wss"`.

## Diseño por frente

**A. Alta y sesión** — `onUserCreated` crea organización salvo en
`runInternalSignup` (sin lock global; slug `negocio-<nanoid>`). `isPublicSignupAllowed`
y `ALLOW_SIGNUP` desaparecen; `hooks.before` de `/sign-up/email` solo rechaza
correos reservados. `databaseHooks.session.create.before` rechaza si la
organización del usuario está suspendida. `requireSession` → carga membresía +
`suspended_at`; si el usuario es super-admin y hay cookie `vocero_imp`, delega
en `resolveImpersonation` (`src/server/platform/impersonation.ts`).
`SessionContext` gana `impersonation: { id, organizationName, suspended } | null`.

**B. Claves** — `src/server/bot/keys.ts`: `generateBotKey`, `hashBotKey`,
`issueBotKey(orgId, userId)` (transacción: revoca activa + inserta),
`revokeBotKey`, `resolveBotKey(raw) → { organizationId } | null`.
`requireBotKey(req)` pasa a devolver `{ organizationId } | Response` y todas las
rutas `/api/bot/*` usan ese id (se borra `resolveInstanceOrg`).

**C. Plataforma** — `src/server/platform/{admins,organizations,audit,impersonation,delete}.ts`.
Es el único módulo con consultas entre tenants; cada función exporta el gate
como primer parámetro implícito vía `withPlatformAdmin(handler)` en
`src/lib/api.ts` (404 si no). Páginas en `src/app/(platform)/admin/` con su
propio layout (sin la navegación de la app).

**D. Suspensión en todos los puntos de entrada**: login (hook de sesión),
`requireSession`, `/api/bot/*`, webhook (`processMessagesValue`,
`processEchoesValue`, `enqueueCoexistencePayload` salvo `account_update`,
`processTemplateStatusValue`), `runAgentTurn` (guardia al inicio), arranque de
corridas del Laboratorio (vía `requireSession`), `drainCoexistenceDeliveries`
(omite filas de organizaciones suspendidas). Helper único
`isOrganizationSuspended(orgId)` en `src/server/platform/suspension.ts`
(consulta por id, cacheable 30 s por org).

**E. Webhook y sincronización** — `lifecycle.ts` decodifica las formas de Meta
(R2/R3) y agrega `kind: "state_sync"`; `sync-worker.ts` enruta
`account_update` por WABA y, al pasar un claim a `active`, fija `activated_at` y
llama a `requestInitialSync` (`src/server/whatsapp/smb-sync.ts`) **después** del
commit. `smb-sync.ts`: `requestInitialSync`, `retrySync`, `applyStateSync`,
`getSyncStatus`. La ruta del webhook también ruta `smb_app_state_sync` y `history`
solo por el buzón durable (nunca por `after()`).

## Constitution Check

*GATE: evaluado antes de la Fase 0 y re-evaluado tras el diseño. Contra la 2.0.0.*

| Principio | Cómo lo cumple |
|---|---|
| **I. Seguridad** | Claves de API solo como sha256; el secreto se muestra una vez con `no-store`. Tokens de coexistence siguen cifrados. Se eliminan los dos `limit(1)` y el test estático impide que vuelvan. La marca sin sesión no toca datos de tenant. |
| **II. Soberanía** | Cero dependencias nuevas; `smb_app_data` y `subscribed_apps` son la misma Graph API del canal. Sin email: el super-admin se verifica por script del operador. |
| **III. Multi-tenancy** | Las tablas nuevas de dominio (`bot_api_key`, `whatsapp_smb_sync_request`) llevan `organization_id NOT NULL` + cascade. Las dos de plataforma son la excepción justificada abajo. |
| **IV. Idempotencia** | Petición de sync reclamada por UNIQUE antes de llamar; reintento con UPDATE condicional; `state_sync` por upsert; `history` por `wa_message_id`; suspender/reactivar/revocar idempotentes. Migración re-ejecutable. |
| **V. Calidad** | Gate técnico + unit de gates y decodificadores + arnés E2E. |
| **VI. Specs antes de código** | Ciclo completo; spec, plan, contratos y enmienda preceden al código. |
| **VII. Trazabilidad** | E1–E9 en la spec; R3 resuelto en T040 (decisión documentada arriba). |
| **VIII. Foco** | Operación de plataforma explícitamente dentro en 2.0.0; billing fuera. |
| **IX. Verificación en vivo** | Arnés contra la app viva con wa-mock: dos organizaciones, panel, sync. |

**Resultado del gate**: PASA con la enmienda 2.0.0 aplicada y una excepción
registrada en Complexity Tracking.

## Project Structure

```
specs/020-plataforma-multitenant/
├── spec.md · plan.md · tasks.md
└── contracts/
    ├── api-key.md        # Ajustes → API y autenticación de /api/bot/*
    ├── plataforma.md     # /api/platform/* y efecto en la sesión
    └── webhook-smb.md    # campos de coexistence y smb_app_data

src/
├── lib/
│   ├── db/schema.ts · db/ids.ts          # + columnas, 4 tablas, 4 prefijos
│   ├── env.ts                             # + PLATFORM_ADMIN_EMAILS; − ALLOW_SIGNUP; BOT_API_KEY solo para avisar
│   ├── api.ts                             # + withPlatformAdmin; withAuth propaga 403 org_suspendida
│   └── auth/{index,session}.ts            # alta abierta, hook de sesión, suplantación
├── server/
│   ├── auth/{on-signup,registration}.ts   # alta por registro; registration → correos reservados
│   ├── bot/{auth,keys,status}.ts          # clave por organización
│   ├── branding.ts                        # sin fallback
│   ├── platform/                          # NUEVO: admins, organizations, audit, impersonation, suspension, delete
│   ├── whatsapp/{lifecycle,sync-worker,smb-sync}.ts
│   ├── inbox/ingest.ts                    # history real + guardia de suspensión
│   ├── ai/pipeline.ts                     # guardia de suspensión
│   └── dev/wa-mock-inbound.ts             # fixtures Meta: state_sync, history, account_update
├── app/
│   ├── (platform)/admin/                  # NUEVO: layout + lista + detalle/auditoría
│   ├── (app)/layout.tsx                   # aviso de suplantación; redirección de super-admin
│   ├── (app)/settings/api/page.tsx        # NUEVO
│   ├── (auth)/register/page.tsx           # copy
│   ├── suspendida/page.tsx                # NUEVO
│   └── api/{platform,settings/api-key,bot/*,webhooks/wa,dev/wa-mock}/…
└── components/{platform,settings}/…

scripts/platform-admin.mjs · scripts/e2e-selftest.mjs
drizzle/0016_plataforma_multitenant.sql
tests/unit/{bot-keys,platform-gate,suspension,impersonation,signup-multitenant,smb-sync,coexistence-meta-shapes,no-single-org}.test.ts
tests/e2e/us-plataforma.md
docs/plataforma.md
```

## Fases

**Fase 0 — Research** ✅ (R1–R8 arriba).

**Fase 1 — Diseño** ✅ Data Model + `contracts/`.

**Fase 2 — Tareas** → `tasks.md`: fundacional (esquema, env) → organización
única fuera → claves → plataforma → webhook/sync → UI → cierre.

**Fase 3 — Implementación y verificación**: gate técnico + `pnpm test:e2e`.

## Complexity Tracking

| Violación / excepción | Por qué es necesaria | Alternativa más simple rechazada |
|---|---|---|
| `platform_audit_event` y `platform_impersonation` sin `organization_id` NOT NULL ni FK cascade | La auditoría debe sobrevivir al borrado de la organización que audita (US6-5); una FK cascade borraría la prueba del borrado. | Guardar la auditoría en una tabla de dominio con cascade: pierde exactamente el evento más importante. |
| Consultas entre tenants en `src/server/platform/` | El panel lista todas las organizaciones (D3). Confinadas a un módulo, tras `withPlatformAdmin`, cubiertas por el test estático. | Consultar por organización en bucle: N+1 y el mismo acceso cruzado, solo que más lento. |
| Suplantación propia en vez del plugin `admin` | R5: el plugin suplanta usuarios y atribuye las acciones al owner. | Plugin `admin`: menos código, peor auditoría. |
