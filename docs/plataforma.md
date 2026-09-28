# Operar la plataforma multi-tenant

Desde la 020, Vocero es **siempre multi-tenant**: cada alta pública en
`/register` crea SU PROPIA organización, aislada de las demás. Este documento
es para quien **opera el servidor** (acceso al shell/`.env`), no para el
dueño de un negocio — ese sigue usando Ajustes dentro de su CRM.

## Alta del super-admin

No hay verificación por correo (Principio II: sin dependencias de email en
el núcleo). "Correo verificado" es un campo (`user.email_verified`) que
**solo** pone el script del operador, con acceso al servidor — la misma
barrera que `scripts/reset-password.mjs`.

1. Agrega el correo a `PLATFORM_ADMIN_EMAILS` en el `.env` (separados por
   coma si hay varios) y reinicia el contenedor/proceso.
2. Crea (o actualiza) la cuenta:

   ```bash
   # bash
   NEW_PASSWORD='contraseña-nueva' node --env-file=.env scripts/platform-admin.mjs correo@ejemplo.com

   # PowerShell
   $env:NEW_PASSWORD='contraseña-nueva'; node --env-file=.env scripts/platform-admin.mjs correo@ejemplo.com
   ```

3. Entra en `/login` con ese correo y contraseña; el panel vive en `/admin`.

El script se niega si el correo no está en `PLATFORM_ADMIN_EMAILS`, o si ya
pertenece a una organización (un super-admin no tiene membresía). Correrlo
dos veces para el mismo correo solo actualiza la contraseña y confirma
`email_verified = true`.

**Nadie más ve `/admin` ni `/api/platform/*`** — ni con sesión, ni siendo
owner de una organización: la superficie responde `404` sin cuerpo, como si
no existiera.

## Qué ve el panel

`/admin` lista cada organización con: nombre, correo del owner, fecha de
alta, estado de WhatsApp (conectado / reconectar / sin conectar) y de
coexistence (pendiente, esperando confirmación, activo, rechazado, revocado,
desconectado), número de contactos, número de mensajes (el Laboratorio nunca
cuenta) y su última actividad. Busca por nombre de la organización o correo
del owner; 50 por página.

## Suspender, reactivar y borrar

- **Suspender** corta el acceso de inmediato: se revocan las sesiones de sus
  miembros, un login nuevo se rechaza con "Tu cuenta está suspendida;
  contacta a soporte", y su API (`/api/bot/*`) responde `403 org_suspendida`.
  Sus webhooks se descartan (con log), salvo el que informa que Meta quitó o
  reinstaló la app (necesario para no dejar credenciales vivas si se
  reconecta). El Laboratorio y el agente tampoco corren. **Nada de lo
  descartado durante la suspensión se recupera al reactivar** — Meta ya
  recibió su `200` y no lo reenvía.
- **Reactivar** limpia la suspensión; sus usuarios vuelven a entrar de
  inmediato.
- **Borrar** es irreversible: el diálogo exige escribir el nombre EXACTO de
  la organización. Borra en cascada todos sus datos (contactos,
  conversaciones, mensajes, leads, citas, credenciales, claves de API…), sus
  archivos (`MEDIA_DIR/{orgId}`) y a los usuarios cuya única membresía era
  esa organización. Intenta (mejor esfuerzo) desuscribir la App de su WABA —
  si Meta falla, el borrado se completa igual y el fallo queda en el log; su
  antiguo número queda libre para conectarse desde otra organización.

Las tres acciones (suspender, reactivar, borrar) quedan en la auditoría con
el admin, la fecha y el nombre/id de la organización — la auditoría **no**
se borra con la organización que audita.

## Entrar como soporte (suplantación)

"Entrar como soporte" abre la app de esa organización con un aviso fijo
("Estás viendo «Negocio» como soporte") y un botón "Salir". Lo que el admin
haga (mandar un mensaje, mover un lead) queda atribuido a SU usuario, nunca
al owner. Reglas:

- Dura 60 minutos, o hasta que el admin salga, cierre su propia sesión, o
  entre a suplantar otra organización (nunca dos a la vez).
- **No** puede crear/borrar cuentas de equipo, generar/rotar/revocar la clave
  de API del cerebro, ni tocar la conexión de WhatsApp (conectar, completar
  Embedded Signup, desconectar): esas rutas responden
  `403 suplantacion_restringida`. Reintentar una sincronización que ya falló
  SÍ está permitido — es soporte válido y no cambia ninguna credencial.
- No se puede suplantar una organización que tenga a OTRO super-admin como
  miembro.
- Cada inicio y cada fin quedan en la auditoría, con el motivo del fin
  (`salida`, `expirada`, `sesion_terminada`, `reemplazada`, `org_borrada`).

## Migración de `BOT_API_KEY`

La variable de entorno global `BOT_API_KEY` **ya no se acepta** — con más de
una organización no hay "la" instancia a la que asignársela; aceptarla habría
sido, en el mejor caso, la clave de OTRO negocio. Si el servidor arranca con
ella definida, solo deja un aviso en el log (nunca imprime su valor). Migra
así:

1. Entra como **owner** a Ajustes → API.
2. Pulsa "Generar" (o "Rotar" si ya había una) — la clave completa se muestra
   UNA sola vez, con un botón para copiarla.
3. Pega esa clave en la variable `X-API-Key` de tu cerebro externo.
4. Borra `BOT_API_KEY` de tu `.env`/plataforma de hosting.

Cada organización tiene como mucho una clave activa; rotarla invalida la
anterior en el mismo instante.

## Sincronización al conectar (coexistence) y su ventana de 24 h

Cuando un negocio conecta su WhatsApp por Embedded Signup y el claim queda
`active`, el CRM le pide a Meta, en ese mismo momento y una sola vez cada
una:

1. **Contactos** (`smb_app_state_sync`).
2. **Historial** (`history`) — solo si la de contactos quedó aceptada.

El owner ve el estado de ambas en Ajustes → WhatsApp: pedida, con progreso
(historial), fallida (con un botón "Reintentar"), o "no compartido" si el
negocio apagó compartir su historial desde la app de WhatsApp Business.
Meta da **24 horas desde la activación** para completar la sincronización;
pasada la ventana, el estado dice "Ventana vencida: reconecta para
sincronizar" y ya no se puede reintentar — hay que repetir el flujo de
Embedded Signup.

Un contacto que llega por la libreta (`smb_app_state_sync`, acción `add`)
nunca pisa un nombre que el owner escribió a mano; y sacar a alguien de la
libreta del teléfono (`remove`) **no** borra su historial comercial en el
CRM — son cosas independientes a propósito.
