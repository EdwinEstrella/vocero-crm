# Tasks — 020 Plataforma multi-tenant

Rama `020-plataforma-multitenant`. Ordenadas por dependencia: sin esquema y sin
la sesión multi-organización no hay nada que aislar ni que gobernar. `[P]` =
paralelizable (archivos distintos, sin dependencia pendiente). Cada fase deja el
gate técnico en verde antes de pasar a la siguiente.

Prerrequisito: constitución **2.0.0** y `CLAUDE.md` ya enmendados en este mismo
cambio (hecho junto con esta spec).

---

## Fase 1 — Fundacional (bloquea todo)

- [X] **T001** `src/lib/db/schema.ts`: `organization.suspendedAt` y
      `suspendedReason`; `whatsappCoexistenceClaim.activatedAt`; tablas
      `platformAuditEvent`, `platformImpersonation`, `botApiKey`,
      `whatsappSmbSyncRequest` con sus índices (UNIQUE y parciales) tal como el
      Data Model de `plan.md`; `contact.nameSource` gana `"libreta"` en el enum TS.
- [X] **T002** `src/lib/db/ids.ts`: prefijos `pae`, `imp`, `bak`, `wss`. [P]
- [X] **T003** `pnpm db:generate` → `drizzle/0016_plataforma_multitenant.sql`
      (aditiva, re-ejecutable: `IF NOT EXISTS` donde drizzle-kit no lo ponga) y
      su entrada en `drizzle/meta/_journal.json`.
- [X] **T004** `src/lib/env.ts`: `PLATFORM_ADMIN_EMAILS` opcional con
      `parsePlatformAdminEmails()` (coma, recorte, minúsculas, vacíos fuera);
      eliminar `ALLOW_SIGNUP`; `BOT_API_KEY` queda solo para el aviso de
      migración (documentado inline). [P]
- [X] **T005** `tests/unit/platform-env.test.ts`: parseo de la lista (mayúsculas,
      espacios, vacíos, ausente = nadie es admin). [P]
- [X] **T006** `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml`:
      quitar `ALLOW_SIGNUP`; agregar `PLATFORM_ADMIN_EMAILS` con guía inline
      (quién lo pone, que exige `scripts/platform-admin.mjs`, que el panel da 404
      a los demás); marcar `BOT_API_KEY` como retirada con la nota de migración
      de `contracts/api-key.md`. [P]

## Fase 2 — US1/US2: alta abierta y fin de la organización única (P1)

- [X] **T007** `src/server/auth/on-signup.ts`: `onUserCreated(userId, name,
      { internal })` crea organización (slug `negocio-<nanoid>`), membresía
      `owner`, etapas y `agentProfile` en una transacción SOLO si no es alta
      interna; quitar el advisory lock 874201 y la condición de cero
      organizaciones. `resolveMembership` devuelve también `suspendedAt` de la
      organización.
- [X] **T008** `src/server/auth/registration.ts`: reemplazar
      `isPublicSignupAllowed` por `isReservedPlatformEmail(email)`.
- [X] **T009** `src/lib/auth/index.ts`: `hooks.before` de `/sign-up/email`
      rechaza correos reservados (`403 correo_reservado`) y nada más;
      `databaseHooks.user.create.after` pasa `isInternalSignup()` a
      `onUserCreated`; `databaseHooks.session.create.before` rechaza con
      `APIError FORBIDDEN` "Tu cuenta está suspendida; contacta a soporte" si la
      organización del usuario está suspendida.
- [X] **T010** `src/app/(auth)/register/page.tsx`: copy "Crea la cuenta de tu
      negocio"; sin mención a "la organización de la instancia". [P]
- [X] **T011** `src/server/branding.ts` + `src/app/api/branding/favicon/route.ts`
      + `src/app/layout.tsx` + `src/app/(auth)/layout.tsx`: sin
      `organizationId` → `DEFAULT_BRANDING` y favicon por defecto; borrar el
      fallback `organization limit(1)`.
- [X] **T012** Auditar estado global de proceso dependiente de tenant:
      `src/server/bot/status.ts` (`markBotSeen`/`botLastSeenAt` con llave por
      organización), `src/server/agenda/connectors/{google,zoom}-credentials.ts`
      (confirmar llave por organización; corregir si no). [P]
- [X] **T013** `tests/unit/registration.test.ts` (reescribir) +
      `tests/unit/signup-multitenant.test.ts`: dos altas públicas → dos
      organizaciones; alta interna → ninguna; correo reservado → rechazado;
      ningún alta marca `emailVerified`.
- [X] **T014** `tests/unit/no-single-org.test.ts`: test estático que recorre
      `src/` y falla si encuentra `from(schema.organization)` seguido de
      `.limit(1)` sin `.where(` fuera de `src/server/platform/`. [P]
- [X] **T015** `tests/unit/branding.test.ts`: sin sesión → marca por defecto aun
      con organizaciones con marca propia. [P]

## Fase 3 — US3: clave de API por organización (P1)

- [X] **T016** `src/server/bot/keys.ts`: `generateBotKey` (`vk_` + 32 bytes
      base64url), `hashBotKey` (sha256 hex), `issueBotKey` (revoca activa +
      inserta en transacción), `revokeBotKey`, `resolveBotKey(raw)` (por hash,
      no revocada; `last_used_at` como mucho 1/min), `getBotKeyView`.
- [X] **T017** `src/server/bot/auth.ts`: `requireBotKey(req)` →
      `{ organizationId } | Response`; 401 + limitador por IP como hoy; `403
      org_suspendida`; presupuesto `bot-api:{organizationId}`; `markBotSeen(orgId)`.
      Borrar `validBotKey` global, `isBotKeyConfigured`, `resolveInstanceOrg` y
      `resetInstanceOrgCache`.
- [X] **T018** Las diez rutas `src/app/api/bot/{bookings,typing,availability,reset,handoff,profile,ficha,context,messages}/route.ts`
      y `src/app/api/bot/media/[mediaId]/route.ts`: tomar `organizationId` de
      `requireBotKey`.
- [X] **T019** `src/app/api/agent/brain-status/route.ts`: `botKeyConfigured` =
      la organización tiene clave activa; `lastSeen` por organización. [P]
- [X] **T020** `src/app/api/settings/api-key/route.ts`: `GET`/`POST`/`DELETE`
      según `contracts/api-key.md` (solo owner, `no-store`, 403 en
      suplantación — usa `session.impersonation` de T028).
- [X] **T021** `src/app/(app)/settings/api/page.tsx` +
      `src/components/settings/api-key-client.tsx` + pestaña en
      `src/components/settings/settings-nav.tsx`: generar/rotar/revocar, secreto
      visible una vez con botón copiar, `last4`, creada, último uso.
- [X] **T022** `src/instrumentation-node.ts`: si `BOT_API_KEY` está definida,
      un `console.warn` de migración sin el valor. [P]
- [X] **T023** `tests/unit/bot-keys.test.ts`: formato y entropía, hash estable,
      clave de A resuelve A y nunca B, revocada → null, rotación invalida la
      anterior, `BOT_API_KEY` global → null, organización suspendida → 403.
      Actualizar `tests/unit/bot-gateway.test.ts`, `brain-status.test.ts`,
      `bot-context-bsuid.test.ts`, `bot-profile.test.ts`,
      `bot-availability-date.test.ts` al nuevo `requireBotKey`.

## Fase 4 — US4–US7: plataforma (P1/P2)

- [X] **T024** `src/server/platform/admins.ts`: `isPlatformAdmin(user)` =
      `emailVerified && email ∈ PLATFORM_ADMIN_EMAILS`; `requirePlatformAdmin()`
      (sesión Better Auth, sin membresía). `src/lib/api.ts`:
      `withPlatformAdmin(handler)` → `404` sin cuerpo si no.
- [X] **T025** `scripts/platform-admin.mjs`: crea (o marca) el usuario del
      correo dado con `NEW_PASSWORD` por entorno, `email_verified = true`, sin
      organización; se niega si el correo no está en `PLATFORM_ADMIN_EMAILS` o
      si ya pertenece a una organización. Uso documentado en la cabecera (bash y
      PowerShell), patrón de `scripts/reset-password.mjs`.
- [X] **T026** `src/server/platform/suspension.ts`: `isOrganizationSuspended(orgId)`
      (caché 30 s por org, invalidada por suspender/reactivar),
      `suspendOrganization` (fija `suspended_at`, borra sesiones de sus
      miembros, auditoría; idempotente), `reactivateOrganization`.
- [X] **T027** `src/server/platform/audit.ts`: `recordPlatformEvent`,
      `listPlatformEvents`. [P]
- [X] **T028** `src/server/platform/impersonation.ts`: `startImpersonation`
      (rechaza objetivo con miembro super-admin; cierra la activa con
      `reemplazada`), `endImpersonation`, `resolveImpersonation(adminUserId,
      sessionId, cookieId)` (valida misma sesión, sin fin, sin expirar; cierra
      con `expirada`/`sesion_terminada` si no), cookie `vocero_imp`.
- [X] **T029** `src/lib/auth/session.ts`: `SessionContext.impersonation`;
      `requireSession` aplica suplantación (T028) para super-admins y `403
      org_suspendida` para miembros de organizaciones suspendidas; nuevo error
      tipado que `withAuth` (`src/lib/api.ts`) traduce a ese código.
- [X] **T030** `src/server/platform/organizations.ts`: `listOrganizations({ q,
      page })` con owner, estados de WhatsApp/coexistence, conteos (sin
      `is_test`) y última actividad, en consultas agregadas (sin N+1).
- [X] **T031** `src/server/platform/delete.ts`: `deleteOrganization(id,
      confirmName, actor)`: valida nombre exacto; cierra suplantaciones
      (`org_borrada`); lee WABA/token antes; borra en transacción la
      organización (cascada) y los usuarios cuya única membresía era ella (no
      super-admins); después, fuera de la transacción, `rm -rf
      MEDIA_DIR/{orgId}` y `DELETE {waba}/subscribed_apps` best-effort;
      auditoría con `metaUnsubscribe`.
- [X] **T032** Rutas `src/app/api/platform/organizations/route.ts`,
      `organizations/[id]/suspend/route.ts`, `organizations/[id]/reactivate/route.ts`,
      `organizations/[id]/route.ts` (DELETE), `impersonation/route.ts`,
      `audit/route.ts`, todas con `withPlatformAdmin` y Zod según
      `contracts/plataforma.md`.
- [X] **T033** `src/app/(platform)/admin/layout.tsx` (gate → `notFound()`),
      `page.tsx` (lista, búsqueda, paginación), `[id]/page.tsx` (detalle +
      auditoría) y `src/components/platform/{organizations-table,suspend-dialog,delete-dialog,impersonate-button}.tsx`;
      el diálogo de borrado habilita el botón solo con el nombre exacto.
- [X] **T034** `src/app/(app)/layout.tsx` + `src/components/platform/impersonation-banner.tsx`:
      aviso fijo con nombre, "suspendida" si aplica y Salir; super-admin sin
      suplantación → `redirect("/admin")`; miembro suspendido →
      `redirect("/suspendida")`.
- [X] **T035** `src/app/suspendida/page.tsx`: mensaje "Tu cuenta está
      suspendida; contacta a soporte" + cerrar sesión. [P]
- [X] **T036** `src/app/api/settings/team/route.ts`: `POST`/`DELETE` → `403
      suplantacion_restringida` con `session.impersonation`. [P]
- [X] **T037** `tests/unit/platform-gate.test.ts`: sin sesión, owner, correo
      listado sin verificar, verificado no listado → 404; admin → pasa. [P]
- [X] **T038** `tests/unit/suspension.test.ts`: `requireSession` → 403;
      hook de sesión rechaza; `requireBotKey` → 403; idempotencia de
      suspender/reactivar. [P]
- [X] **T039** `tests/unit/impersonation.test.ts`: misma sesión o nada,
      expiración, objetivo protegido, una activa por admin, restricciones de
      equipo/clave, acciones atribuidas al admin. [P]

## Fase 5 — US8/US9: webhook y sincronización (P1)

- [X] **T040** Resolver el NEEDS CLARIFICATION R3 de `plan.md` (evento real de
      alta por coexistence) con una entrega real o la referencia vigente;
      anotar el resultado en `plan.md` → R3 antes de T041.
- [X] **T041** `src/server/whatsapp/lifecycle.ts`: decodificadores con las formas
      de Meta (`contracts/webhook-smb.md`): `account_update` por WABA con la
      tabla de eventos, `history` anidado (hilos, fase, progreso, error
      2593109), `smb_app_state_sync` → `kind: "state_sync"`; retirar la forma de
      fixture (`coexistence.event`, `consented_at`).
- [X] **T042** `src/server/whatsapp/sync-worker.ts`: enrutar `account_update`
      por `whatsapp_coexistence_claim.waba_id`; persistir `state_sync`;
      descartar con log (antes de persistir) lo de organizaciones suspendidas
      salvo `account_update`; `drainCoexistenceDeliveries` omite organizaciones
      suspendidas; al pasar a `active` fijar `activated_at` y, tras el commit,
      `requestInitialSync`.
- [X] **T043** `src/server/whatsapp/smb-sync.ts`: `requestInitialSync(orgId)`
      (reclamo UNIQUE → llamada → `requested`/`failed`; `history` solo tras
      `smb_app_state_sync` `requested`), `retrySync(orgId, type)` (UPDATE
      condicional, ventana abierta), `applyStateSync(orgId, value)` (E2/E3),
      `recordHistoryProgress`, `markHistoryDeclined`, `getSyncStatus(orgId)`
      (calcula `expired`). Llamadas vía `graphRequest`, nunca en transacción,
      errores redactados.
- [X] **T044** `src/server/inbox/ingest.ts`: `ingestHistoricalMessages` sobre
      hilos (contacto = `threads[].id`, dirección por número del negocio,
      `import_source = "history"`, sin agente, un SSE de refresco por lote);
      guardia de suspensión en `processMessagesValue` y `processEchoesValue`
      (log `[webhook] org suspendida` + descarte).
- [X] **T045** `src/server/inbox/identity.ts`: precedencia `manual > libreta >
      perfil` (el nombre de perfil solo reemplaza `perfil`). [P]
- [X] **T046** `src/server/whatsapp/template-events.ts`: guardia de suspensión
      tras resolver la organización por WABA. [P]
- [X] **T047** `src/app/api/webhooks/wa/[webhookToken]/route.ts`:
      `history` y `smb_app_state_sync` solo por el buzón durable;
      `account_update` encolado aunque la organización esté suspendida; los
      seis campos cubiertos, el resto ignorado sin error.
- [X] **T048** `src/server/ai/pipeline.ts`: `runAgentTurn` sale sin efectos si
      la organización está suspendida. [P]
- [X] **T049** `src/server/dev/wa-mock-inbound.ts` + `src/app/api/dev/wa-mock/coexistence/route.ts`:
      `buildStateSyncPayload` (add/remove, varias entradas), reescribir
      `buildCoexistenceHistoryPayload` y `buildCoexistenceLifecyclePayload` a la
      forma de Meta, más el caso `history` declinado.
- [X] **T050** `src/app/api/dev/wa-mock/graph/[...path]/route.ts`: `POST
      {pn}/smb_app_data` (valida cuerpo, `request_id`, `-fail` → 400) y registra
      las llamadas en el outbox para que el arnés cuente cuántas hubo. [P]
- [X] **T051** `src/app/api/settings/whatsapp/route.ts` (GET agrega
      `sync: { contacts, history }`) + `src/app/api/settings/whatsapp/sync/route.ts`
      (`POST { type }` → `retrySync`; solo `owner`, y permitido también al
      super-admin suplantando: reintentar es una operación de soporte válida) +
      `src/components/settings/whatsapp-wizard.tsx`: estados y hora límite.
- [X] **T052** `tests/unit/coexistence-meta-shapes.test.ts`: decodificación de
      los fixtures de Meta (los tres campos), eventos de `account_update`,
      desconocidos ignorados; actualizar `whatsapp-coexistence-lifecycle.test.ts`
      y `wa-mock-coexistence.test.ts`. [P]
- [X] **T053** `tests/unit/smb-sync.test.ts`: una sola petición por tipo con
      confirmaciones repetidas, `history` no sale si contactos falló, reintento
      condicional, ventana vencida, `add` crea/actualiza sin pisar `manual`,
      `remove` sin efecto, entrada sin teléfono ignorada, aislamiento (el mismo
      teléfono en A y B son dos contactos). [P]

## Fase 6 — Cierre

- [ ] **T054** `tests/e2e/us-plataforma.md`: guion de las historias US1–US9.
- [ ] **T055** `scripts/e2e-selftest.mjs` — setup: el `sign-in` de respaldo deja
      de depender del registro cerrado; `BOT_KEY` sale de `POST
      /api/settings/api-key` en lugar del entorno.
- [ ] **T056** `scripts/e2e-selftest.mjs` — sección "multi-tenant": registrar
      org A y org B (correos únicos por corrida), 404 cruzados en contacto,
      conversación y lead; clave de A contra conversación de B → 404;
      `BOT_API_KEY` global → 401; login sin sesión con marca por defecto.
- [ ] **T057** `scripts/e2e-selftest.mjs` — sección "plataforma": crear el
      super-admin con `scripts/platform-admin.mjs` (correo e2e listado en
      `PLATFORM_ADMIN_EMAILS` del `.env`), owner → `/api/platform/*` 404; admin:
      listar (A y B con conteos), suplantar A (ve la bandeja de A, equipo → 403),
      salir, suspender B (login de B rechazado, inbound de B descartado, clave
      de B → 403), reactivar, borrar B con nombre incorrecto (422) y correcto
      (200), auditoría con los eventos esperados.
- [ ] **T058** `scripts/e2e-selftest.mjs` — sección "sincronización": activar un
      claim vía el mock (`account_update` con forma de Meta), comprobar dos
      llamadas a `smb_app_data` en orden y ninguna más tras reenviar la
      activación; `smb_app_state_sync` add → contacto visible en
      `/api/contacts` con nombre de libreta; `remove` → sigue ahí; `history` →
      mensajes con dirección correcta; `-fail` → estado `failed` y reintento.
- [ ] **T059** `docs/plataforma.md`: operar la plataforma — alta del
      super-admin, qué ve el panel, suspender/borrar, suplantar y su auditoría,
      migración de `BOT_API_KEY`, sincronización y su ventana de 24 h. [P]
- [ ] **T060** `README.md`: "una instancia = un negocio" → plataforma
      multi-tenant; enlace a `docs/plataforma.md`. [P]
- [ ] **T061** Gate técnico completo: `pnpm typecheck && pnpm lint && pnpm build
      && pnpm test`, y `pnpm test:e2e` contra la app viva con
      `WA_MOCK_ENABLED=true`, `META_GRAPH_BASE_URL` → wa-mock,
      `OPENROUTER_BASE_URL` → ai-mock, `WHATSAPP_EMBEDDED_SIGNUP=on` y
      `PLATFORM_ADMIN_EMAILS` con el correo e2e. Migración `0016` aplicada dos
      veces sobre la misma base sin error. Anotar el resultado al pie de este
      archivo.
