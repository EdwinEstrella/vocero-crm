# Feature Specification: Plataforma multi-tenant — alta abierta, super-admin, claves de API por organización y sincronización al conectar

**Feature Branch**: `020-plataforma-multitenant`

**Created**: 2026-09-27

**Status**: Especificada antes de escribir código.

**Input**: decisión del dueño del 2026-09-27: Vocero deja de ser "una instancia =
un negocio" y pasa a ser una plataforma **siempre multi-tenant**. Cada negocio se
registra solo, conecta su WhatsApp por Embedded Signup (coexistence) y opera
aislado. El operador tiene un panel de super-administrador para listar,
suspender, borrar y entrar como soporte a cualquier organización.

**Carril**: **ciclo completo** (Principio VI). Toca el modelo de datos (columnas
y tablas nuevas) y dos contratos publicados: `/api/bot/*` (cambia su
autenticación) y el webhook de WhatsApp (procesa campos que hoy descarta).
Exige además la enmienda constitucional **2.0.0** (MAJOR), redactada en este
mismo cambio en `.specify/memory/constitution.md`.

## Contexto

El modelo de datos de Vocero es multi-tenant real desde 1.0 (`organization_id`
NOT NULL en toda tabla de dominio, `scoped()` en toda consulta). Lo que no lo es
todavía es el **código alrededor**, que asume en varios puntos que existe una
sola organización:

| Suposición de organización única | Dónde vive hoy |
|---|---|
| El registro solo crea organización si no hay ninguna, y luego se cierra | `src/server/auth/registration.ts:9-14`, `src/server/auth/on-signup.ts:22-59`, `src/lib/auth/index.ts:77-85` |
| La API del cerebro externo usa una clave global y "la" organización | `src/server/bot/auth.ts:13-28,66-89` (`BOT_API_KEY`, `resolveInstanceOrg` con `organization limit(1)`), usado por las diez rutas de `src/app/api/bot/*` |
| La marca del login sale de "la" organización | `src/server/branding.ts:41-44` (fallback `organization limit(1)` sin sesión) |
| "Quién responde" es un dato global de proceso | `src/server/bot/status.ts:40-55` (`markBotSeen` sin organización) |
| El copy del registro promete crear "la" organización | `src/app/(auth)/register/page.tsx` |

Con N organizaciones, cada uno de esos puntos es un cruce de datos entre
negocios (Principio I). Esta feature los retira, abre el registro, agrega la
operación de plataforma y completa lo que el alta por Embedded Signup necesita
para que un negocio nuevo llegue con sus contactos e historial.

## Decisiones del dueño (2026-09-27) — fijas

- **D1 — Siempre multi-tenant, sin bandera.** No hay modo "organización única".
- **D2 — Registro público abierto.** Cada alta pública crea SU organización (rol
  `owner`) y queda activa de inmediato. Las cuentas de equipo que crea un owner
  (flujo existente `/api/settings/team`) se unen a la organización del owner.
- **D3 — Panel de super-admin** con cuatro capacidades: listar organizaciones con
  métricas, suspender/reactivar, borrar (irreversible) y suplantar (auditado).
- **D4 — Identidad del super-admin por entorno**: `PLATFORM_ADMIN_EMAILS`
  (separada por comas, sin distinguir mayúsculas), contra el correo **verificado**
  del usuario con sesión. Gate server-side; la superficie responde 404 a los
  demás.
- **D5 — `/api/bot/*` con clave por organización**: se genera, rota y revoca en
  Ajustes por el owner, se muestra una sola vez y se guarda como sha256; buscar
  por hash resuelve la organización.
- **D6 — Embedded Signup (coexistence) es EL camino de alta del canal.** Ya
  existe (`src/server/whatsapp/{coexistence,lifecycle,sync-worker}.ts`, commit
  `f5eb5f4`).
- **D7 — Sincronización al conectar**: al confirmarse el claim de coexistence se
  pide a Meta la sincronización de contactos y luego la de historial, una sola
  vez cada una, y el estado se ve en Ajustes → WhatsApp.
- **D8 — Todos los campos suscritos del webhook se procesan**: `messages`,
  `smb_message_echoes`, `message_template_status_update`, `history`,
  `smb_app_state_sync`, `account_update`.

## Decisiones de diseño tomadas en esta spec (revisables — Principio VII)

- **E1 — `BOT_API_KEY` global deja de aceptarse.** Ni siquiera con una sola
  organización: aceptarla "si hay una" reintroduce el `limit(1)` que esta
  feature elimina, y la segunda alta pública convertiría en silencio una clave
  válida en inválida (o peor, en la de otro negocio si se relajara la regla). Al
  arrancar con `BOT_API_KEY` definida, el servidor escribe un aviso de migración
  en el log. Nota de migración en `.env.example` y en la guía.
- **E2 — `smb_app_state_sync` con `action: "remove"` NO borra ni altera el
  contacto del CRM**: se ignora (se cuenta en el log). El contacto del CRM tiene
  conversaciones, leads y citas; que el negocio lo quite de la libreta de su
  teléfono no es una orden de borrar su historial comercial.
- **E3 — Nombre de libreta**: `add` (Meta usa `add` para alta y edición; `edit`
  se acepta igual por defensa) crea o actualiza el contacto por su teléfono
  normalizado. El nombre entra con un origen nuevo, `libreta`, con precedencia
  `manual > libreta > perfil`: nunca pisa un nombre manual, y el nombre de perfil
  de WhatsApp de un mensaje posterior no pisa el de la libreta. Una entrada sin
  teléfono se ignora (no hay llave estable con qué empatarla).
- **E4 — Alta del super-admin sin correo**: la constitución prohíbe email en el
  núcleo, así que no hay verificación por correo. "Correo verificado" se define
  como `user.email_verified = true`, y ese valor solo lo pone el script del
  operador `scripts/platform-admin.mjs` (acceso al servidor = la misma barrera
  que `scripts/reset-password.mjs`). El registro público nunca marca un correo
  como verificado, y rechaza los correos listados en `PLATFORM_ADMIN_EMAILS`
  (así nadie puede adelantarse a registrar el correo del operador). El
  super-admin no pertenece a ninguna organización.
- **E5 — Un usuario pertenece a exactamente una organización.** No hay selector
  de organización (fuera de alcance). El alta de equipo con un correo existente
  sigue respondiendo `409 duplicate`.
- **E6 — Suplantación como sesión de soporte ligada a la sesión del admin**: una
  fila de auditoría (quién, a qué organización, inicio, fin, motivo de fin) y una
  cookie httpOnly que la referencia, válida solo junto con la misma sesión de
  Better Auth del admin y por 60 minutos. Dentro, el admin actúa con rol `owner`
  **menos** tres acciones sensibles (ver FR-034). No se puede suplantar una
  organización que tenga entre sus miembros a otro super-admin, ni anidar
  suplantaciones.
- **E7 — Suspensión**: se permite suplantar una organización suspendida (soporte
  necesita ver por qué), con el aviso diciendo "suspendida". El `account_update`
  de una organización suspendida **sí** se procesa: solo puede reducir
  capacidades (revocar, desconectar) y descartarlo dejaría credenciales vivas al
  reactivar. Todo lo demás se descarta con log.
- **E8 — Baja**: además del borrado en cascada de la base (todas las tablas con
  `organization_id` ya cascadean), se borran los archivos de `MEDIA_DIR/{orgId}`,
  los usuarios cuya única membresía era esa organización, y se intenta (mejor
  esfuerzo, sin bloquear) desuscribir la App de la WABA
  (`DELETE /{waba_id}/subscribed_apps`) para dejar de recibir sus mensajes.
- **E9 — Marca sin sesión**: el login y el layout raíz sin sesión usan la marca
  por defecto de la plataforma (`DEFAULT_BRANDING`), sin datos de ningún tenant.

## Alcance

**Dentro**: alta pública multi-organización; retiro de toda resolución de
organización sin tenant; panel de super-admin (listar, suspender/reactivar,
borrar, suplantar) con auditoría; claves de API por organización; procesamiento
de los seis campos del webhook con la forma documentada por Meta; petición única
de sincronización de contactos e historial al confirmar el claim y su estado en
Ajustes; fixtures de wa-mock y arnés E2E.

**Fuera**: ver "Qué se decidió NO hacer".

## User Scenarios & Testing

### User Story 1 — Un negocio se registra solo (Priority: P1)

**Como** dueño de un negocio, **quiero** crear mi cuenta en la plataforma y
entrar a MI CRM vacío, **para** conectar mi WhatsApp sin pedirle nada al
operador.

**Acceptance Scenarios**:

1. **Given** una plataforma con otras organizaciones, **When** me registro en
   `/register`, **Then** se crea una organización nueva con mi usuario como
   `owner`, el pipeline sembrado (5 etapas) y el perfil del agente, y entro a la
   bandeja vacía.
2. **Given** dos registros simultáneos, **Then** se crean dos organizaciones
   distintas, cada una con su owner (sin lock global de "primer arranque").
3. **Given** un owner que crea una cuenta de equipo, **Then** esa cuenta se une a
   SU organización y **no** crea otra.
4. **Given** un correo listado en `PLATFORM_ADMIN_EMAILS`, **When** alguien lo
   intenta registrar públicamente, **Then** responde `403 correo_reservado` y no
   se crea usuario.
5. **Given** la pantalla de registro, **Then** el texto dice que se crea TU
   negocio, no "la organización de la instancia".

### User Story 2 — Aislamiento entre negocios (Priority: P1)

**Como** negocio A, **quiero** que nada de lo mío sea visible ni modificable
desde el negocio B, **para** confiar mis clientes a la plataforma.

1. **Given** las organizaciones A y B con contactos, conversaciones y leads,
   **When** un usuario de B pide por id un recurso de A (contacto, conversación,
   lead, mensaje, adjunto), **Then** recibe 404.
2. **Given** la clave de API de A, **When** llama a `/api/bot/context` con una
   conversación de B, **Then** recibe 404; con una de A, 200.
3. **Given** el login sin sesión, **Then** la marca mostrada es la de la
   plataforma, nunca la de una organización.
4. **Given** un inbound al `phone_number_id` de A, **Then** solo aparece en la
   bandeja de A (ya hoy; se re-verifica con dos organizaciones).
5. **Given** el código, **Then** no queda ninguna consulta `from(organization)`
   con `limit(1)` que no esté filtrada por un id derivado de la petición (test
   estático).

### User Story 3 — Clave de API por organización (Priority: P1)

**Como** owner que conecta su propio cerebro, **quiero** generar mi clave en
Ajustes, **para** que mi microservicio solo vea MI organización.

1. **Given** Ajustes → API sin clave, **When** el owner pulsa "Generar", **Then**
   ve la clave completa UNA sola vez, con un aviso de copiarla; después solo ve
   sus últimos 4, la fecha de creación y el último uso.
2. **When** rota, **Then** la clave anterior deja de funcionar en ese mismo
   instante y se muestra la nueva una vez.
3. **When** revoca, **Then** `/api/bot/*` con esa clave responde 401.
4. **Given** un miembro no owner (o un admin suplantando), **Then** no puede
   generar, rotar ni revocar (403).
5. **Given** la variable `BOT_API_KEY` global, **When** se usa como
   `X-API-Key`, **Then** responde 401 y el arranque registró el aviso de
   migración.
6. **Given** una clave de una organización suspendida, **Then** `403
   org_suspendida`.
7. **Then** el presupuesto de 1200/min y "quién responde" son por organización:
   el cerebro de A no agota el de B ni aparece como "visto" en B.

### User Story 4 — El operador ve y gobierna la plataforma (Priority: P1)

**Como** super-admin, **quiero** una lista de organizaciones con su estado,
**para** dar soporte y actuar ante abuso.

1. **Given** un usuario cuyo correo verificado está en `PLATFORM_ADMIN_EMAILS`,
   **When** entra a `/admin`, **Then** ve cada organización con: nombre, correo
   del owner, fecha de alta, estado de WhatsApp (conectado / reconectar / sin
   conectar) y de coexistence (pendiente, esperando confirmación, activo,
   rechazado, revocado, desconectado), número de contactos, número de mensajes y
   última actividad (último mensaje), con búsqueda por nombre o correo y
   paginación de 50.
2. **Given** cualquier otro usuario (con o sin sesión, owner incluido), **When**
   pide `/admin` o `/api/platform/*`, **Then** 404, sin cuerpo que delate que
   existe.
3. **Given** un usuario con el correo listado pero `email_verified = false`,
   **Then** 404.

### User Story 5 — Suspender y reactivar (Priority: P1)

1. **When** el super-admin suspende la organización A, **Then** las sesiones de
   sus miembros se revocan; el siguiente request de un usuario de A recibe `403
   org_suspendida` en la API y la pantalla "Tu cuenta está suspendida; contacta a
   soporte" en la app; y un nuevo login de un miembro de A se rechaza con ese
   mismo mensaje.
2. **Given** A suspendida, **When** llega un webhook de `messages`,
   `smb_message_echoes`, `history`, `smb_app_state_sync` o
   `message_template_status_update` para su número, **Then** se descarta con un
   log `[webhook] org suspendida` y no se persiste nada; el `account_update` sí
   se procesa (E7).
3. **Given** A suspendida, **Then** el agente no corre (guardia en el pipeline
   además de la del webhook), el Laboratorio no arranca y el worker de
   coexistence deja sus filas pendientes sin procesarlas.
4. **When** se reactiva, **Then** sus usuarios vuelven a entrar y los webhooks
   nuevos se procesan (lo descartado durante la suspensión no se recupera; así lo
   dice el diálogo de suspensión).
5. **Then** suspender y reactivar quedan en la auditoría con autor y fecha.

### User Story 6 — Borrar una organización (Priority: P2)

1. **When** el super-admin pulsa "Borrar", **Then** un diálogo explica que es
   irreversible y exige escribir el nombre exacto de la organización; sin
   coincidencia exacta el botón no se habilita y la API responde `422
   confirmacion_invalida`.
2. **When** confirma, **Then** se borran en cascada todos sus datos (contactos,
   conversaciones, mensajes, leads, citas, credenciales de Meta, attempts,
   claims y entregas de coexistence, claves de API, peticiones de
   sincronización), sus archivos en `MEDIA_DIR/{orgId}`, y los usuarios cuya
   única membresía era esa organización.
3. **Then** se intenta desuscribir la App de su WABA; si Meta falla, el borrado
   se completa igual y el fallo queda en el log.
4. **Then** un webhook posterior a su antiguo `phone_number_id` se descarta como
   número desconocido, y el número queda libre para conectarse desde otra
   organización.
5. **Then** la auditoría conserva la fila del borrado con el nombre y el id de la
   organización borrada (no depende de que la organización exista).
6. **Given** una suplantación activa sobre esa organización, **Then** termina con
   motivo `org_borrada`.

### User Story 7 — Entrar como soporte (Priority: P2)

1. **When** el super-admin pulsa "Entrar como soporte" en la organización A,
   **Then** queda registrada la suplantación (admin, organización, inicio) y el
   admin ve la app de A con un aviso fijo "Estás viendo «A» como soporte" y un
   botón "Salir".
2. **When** pulsa "Salir", **Then** la suplantación se cierra (fin + motivo
   `salida`) y vuelve a `/admin`.
3. **Given** 60 minutos sin salir, o un cierre de sesión del admin, **Then** la
   suplantación deja de valer y se registra su fin (`expirada` /
   `sesion_terminada`) en el siguiente request o al iniciar otra.
4. **Given** la suplantación, **Then** lo que el admin haga (enviar un mensaje,
   mover un lead) queda atribuido a SU usuario, no al owner.
5. **Given** la suplantación, **Then** no puede crear/borrar cuentas de equipo,
   generar/rotar/revocar la clave de API, ni ver secretos (nunca se ven, ya hoy):
   `403 suplantacion_restringida`.
6. **Given** una organización con otro super-admin como miembro, **Then** no se
   puede suplantar (`403`). **Given** una suplantación activa, **When** inicia
   otra, **Then** la anterior se cierra primero (nunca dos a la vez).

### User Story 8 — Llegar con contactos e historial (Priority: P1)

**Como** negocio que conecta su WhatsApp Business por coexistence, **quiero** que
mis contactos y mis conversaciones recientes aparezcan en el CRM, **para** no
empezar de cero.

1. **Given** un claim de coexistence que pasa a `active`, **Then** el CRM pide a
   Meta la sincronización de contactos (`smb_app_state_sync`) y, si Meta la
   acepta, la de historial (`history`), una vez cada una; ambas quedan
   registradas con su `request_id`.
2. **Given** la confirmación repetida (reintento del webhook, reinicio a mitad),
   **Then** no se vuelve a pedir ninguna de las dos (UNIQUE por organización,
   número y tipo; se reclama la fila antes de llamar a Meta).
3. **Given** un webhook `smb_app_state_sync` con `action: "add"`, **Then** el
   contacto se crea o actualiza con el nombre de la libreta (E3), y un
   `remove` no lo toca (E2).
4. **Given** un webhook `history` con hilos, **Then** los mensajes se importan
   con su dirección correcta (entrante si `from` es el cliente, saliente si es
   el número del negocio), sin disparar al agente, idempotentes por
   `wa_message_id`; y el progreso reportado por Meta se refleja en el estado.
5. **Given** un `history` con el error `2593109` (el negocio apagó compartir
   historial), **Then** el estado dice "El negocio no compartió su historial" y
   no se reintenta.
6. **Given** que Meta rechaza la petición, **Then** el estado dice "falló" con un
   motivo redactado y el owner tiene un botón "Reintentar" mientras la ventana de
   24 horas siga abierta; pasada la ventana, "Ventana vencida: reconecta para
   sincronizar".
7. **Given** Ajustes → WhatsApp, **Then** el owner ve el estado de contactos
   (pedida / N contactos recibidos / falló / vencida) y de historial (pedida /
   progreso % / no compartido / falló / vencida).

### User Story 9 — El webhook procesa lo que la plataforma suscribe (Priority: P1)

1. **Given** un `account_update` con `event` de Meta (`PARTNER_ADDED`,
   `PARTNER_APP_INSTALLED`, `PARTNER_REMOVED`, `PARTNER_APP_UNINSTALLED`,
   `ACCOUNT_OFFBOARDED`, `ACCOUNT_DELETED`), **Then** se enruta por `waba_id`
   (el `entry.id` o `waba_info.waba_id`; ese evento NO trae `phone_number_id`) y
   mueve el estado del claim según la tabla del plan. Los demás eventos se
   registran y se ignoran sin error.
2. **Given** cualquiera de los seis campos con un número/WABA desconocido,
   **Then** se descarta con log y 200 (Meta no reintenta).
3. **Given** el mock de WhatsApp, **Then** puede emitir `smb_app_state_sync`,
   `history` (forma anidada de Meta) y `account_update` (forma de Meta) contra
   el webhook real.

### Edge Cases

- Registro en una plataforma con cero organizaciones: igual que cualquier otro
  (no hay "primera" especial).
- Super-admin sin organización que entra a `/inbox`: se le redirige a `/admin`.
- Owner único que intenta salir de su organización o borrarse: fuera de alcance
  (no existe hoy); solo el super-admin borra organizaciones.
- Organización borrada con sesiones abiertas: las sesiones cascadean con sus
  usuarios; los usuarios de equipo que tuvieran otra membresía (no debería
  existir por E5) se conservan.
- Una entrada de `smb_app_state_sync` con un teléfono que ya existe como
  `bsuid:` en el CRM: se crea un contacto por teléfono (la unificación de
  identidades está fuera de alcance, igual que hoy).
- El webhook de un número conectado en una organización que se está borrando:
  la fila desaparece dentro de la transacción; el webhook posterior es
  "desconocido".

## Requirements

### Functional Requirements

**Alta y sesión**

- **FR-001**: `/sign-up/email` público MUST estar abierto sin condición de número
  de organizaciones. `ALLOW_SIGNUP` deja de existir.
- **FR-002**: Cada alta pública MUST crear una organización nueva (slug único
  generado, no `principal`), su membresía `owner`, las 5 etapas sembradas y el
  `agentProfile`, en una sola transacción.
- **FR-003**: Un alta interna (`runInternalSignup`: equipo o script de
  super-admin) MUST NOT crear organización.
- **FR-004**: El registro público MUST rechazar correos listados en
  `PLATFORM_ADMIN_EMAILS` con `403 correo_reservado` y MUST NOT marcar ningún
  correo como verificado.
- **FR-005**: `requireSession` MUST resolver la organización desde la membresía
  del usuario (o desde una suplantación válida, FR-031) y MUST rechazar con `403
  org_suspendida` si esa organización está suspendida (salvo suplantación).
- **FR-006**: La creación de sesión (login) de un usuario cuya organización está
  suspendida MUST fallar con el mensaje "Tu cuenta está suspendida; contacta a
  soporte".

**Aislamiento**

- **FR-010**: Ningún módulo fuera de `src/server/platform/` MUST consultar
  `organization` sin filtrar por un id derivado de la petición. Se eliminan
  `resolveInstanceOrg` y el fallback de `getBrandingContext`.
- **FR-011**: Sin sesión, la marca MUST ser la de la plataforma y MUST NOT
  revelar datos de un tenant (incluido el favicon público).
- **FR-012**: Todo estado en memoria de proceso que dependa del tenant (último
  visto del cerebro, presupuesto de la API del bot) MUST llevar el id de la
  organización en su llave.

**Claves de API**

- **FR-020**: El owner MUST poder generar, rotar y revocar la clave de su
  organización en Ajustes → API. Máximo una clave activa por organización.
- **FR-021**: La clave MUST tener ≥ 32 bytes aleatorios, prefijo reconocible
  (`vk_`), mostrarse completa solo en la respuesta que la crea, y persistirse
  como sha256 hex + últimos 4.
- **FR-022**: `/api/bot/*` MUST resolver la organización buscando el sha256 de
  `X-API-Key` entre las claves no revocadas; sin coincidencia, 401 con el mismo
  limitador de fallos por IP de hoy.
- **FR-023**: `BOT_API_KEY` MUST NOT aceptarse; si está definida, el arranque
  MUST registrar un aviso de migración (sin imprimir su valor).
- **FR-024**: `GET /api/agent/brain-status` MUST reportar "clave configurada" y
  "último visto" de la organización de la sesión.

**Plataforma**

- **FR-030**: Es super-admin quien tiene sesión, `email_verified = true` y su
  correo (normalizado a minúsculas y sin espacios) está en
  `PLATFORM_ADMIN_EMAILS`. Todo `/admin` y `/api/platform/*` MUST responder 404 a
  cualquier otro, comprobándolo en el servidor en cada request.
- **FR-031**: La suplantación MUST persistirse (admin, organización, id de sesión
  del admin, inicio, expiración a 60 min, fin, motivo de fin) y valer solo con la
  misma sesión del admin, sin fin y sin expirar.
- **FR-032**: Iniciar, terminar, suspender, reactivar y borrar MUST registrar un
  evento de auditoría con el admin, la acción, el id y el nombre de la
  organización y la fecha. La auditoría no se borra con la organización.
- **FR-033**: La app MUST mostrar durante la suplantación un aviso fijo con el
  nombre de la organización, su estado (suspendida si aplica) y un botón Salir.
- **FR-034**: Durante la suplantación, las rutas de equipo (`POST/DELETE
  /api/settings/team`) y de clave de API MUST responder `403
  suplantacion_restringida`.
- **FR-035**: No se MUST poder suplantar una organización con un miembro
  super-admin, ni tener dos suplantaciones activas del mismo admin.
- **FR-036**: Suspender MUST poner `organization.suspended_at`, revocar las
  sesiones de sus miembros y ser idempotente; reactivar MUST limpiarlo.
- **FR-037**: Borrar MUST exigir `confirmName` idéntico al nombre actual y MUST
  borrar lo listado en US6-2 y E8; el intento de desuscripción en Meta MUST ser
  mejor esfuerzo.

**Webhook y sincronización**

- **FR-040**: El webhook MUST procesar `messages`, `smb_message_echoes`,
  `message_template_status_update`, `history`, `smb_app_state_sync` y
  `account_update`; cualquier otro campo se ignora sin error.
- **FR-041**: Para una organización suspendida, todos excepto `account_update`
  MUST descartarse con log antes de persistir nada.
- **FR-042**: `history` y `account_update` MUST decodificarse con la forma
  documentada por Meta (plan, R2 y R3); el decodificador actual derivado de
  fixtures se reemplaza.
- **FR-043**: Al pasar un claim a `active`, el sistema MUST pedir
  `smb_app_state_sync` y después `history` a `POST /{phone_number_id}/smb_app_data`,
  reclamando antes una fila UNIQUE (organización, número, tipo); una fila ya
  existente nunca se vuelve a pedir automáticamente.
- **FR-044**: El owner MUST ver el estado de ambas sincronizaciones y MUST poder
  reintentar manualmente una petición en `fallida` mientras no hayan pasado 24 h
  desde la activación.
- **FR-045**: `smb_app_state_sync` MUST aplicar E2 y E3.
- **FR-046**: Ningún mensaje importado por `history` MUST disparar al agente ni
  cambiar `handoff`/`ai_enabled`.

### Key Entities

- **Organización**: + `suspended_at`, `suspended_reason` (solo visible al
  super-admin).
- **Evento de auditoría de plataforma**: admin, acción, organización (id y
  nombre copiados), metadatos, fecha. No es una tabla de dominio: no cascadea.
- **Suplantación**: admin, organización, sesión, inicio, expiración, fin, motivo.
- **Clave de API del cerebro**: organización, hash, últimos 4, creada por, fecha,
  último uso, revocada.
- **Petición de sincronización SMB**: organización, número, tipo, estado,
  `request_id`, error redactado, contador de contactos recibidos / progreso de
  historial, ventana de 24 h.
- **Contacto**: `name_source` gana el valor `libreta`.

## Success Criteria

- **SC-001**: Dos altas públicas seguidas producen dos organizaciones aisladas;
  el arnés verifica 404 cruzados en contactos, conversaciones y `/api/bot/*`.
- **SC-002**: El arnés recorre como super-admin: listar → suplantar → salir →
  suspender (login rechazado, webhook descartado) → reactivar → borrar, y la
  auditoría tiene los seis eventos.
- **SC-003**: Un `smb_app_state_sync` emitido por el mock crea/actualiza
  contactos visibles en `/contacts` y un `remove` no borra ninguno.
- **SC-004**: `rg "from\(schema\.organization\)" src` fuera de
  `src/server/platform/` solo devuelve consultas filtradas por id (test estático
  en Vitest).
- **SC-005**: Gate técnico + `pnpm test:e2e` en verde.

## Qué se decidió NO hacer, y por qué

| Qué | Por qué no |
|---|---|
| Billing, planes, límites por plan | Fuera por decisión explícita; el Principio II lo prohíbe como dependencia del núcleo. |
| Selector de organización / un usuario en varias | E5: no lo pidió nadie y duplica la superficie de aislamiento. |
| Verificación de correo, "olvidé mi contraseña" | Requiere un servicio de email (Principio II). El script de reset sigue siendo la salida. |
| Aceptar `BOT_API_KEY` con una sola organización | E1. |
| Borrar contactos del CRM por `remove` de la libreta | E2. |
| Recuperar webhooks descartados durante una suspensión | Meta no reenvía lo que ya recibió 200; guardarlos sería procesar datos de una cuenta suspendida. |
| Retirar la conexión manual por token | No se pidió; `f5eb5f4` ya gobierna su visibilidad con Embedded Signup encendido. |
| Unificar un contacto `bsuid:` con su teléfono al llegar de la libreta | Problema de identidad existente, independiente de esta feature. |
| Cuotas por organización (mensajes, contactos) | Sin billing no hay contra qué medirlas. |
