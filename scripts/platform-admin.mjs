/**
 * Crea (o marca) al super-administrador de la plataforma.
 *
 * 020 (E4) — La constitución prohíbe email en el núcleo, así que no hay
 * verificación por correo: "correo verificado" es `user.email_verified =
 * true`, y ese valor SOLO lo pone este script. Requiere acceso al servidor —
 * la misma barrera que `scripts/reset-password.mjs` — y se niega si:
 *   - el correo no está en PLATFORM_ADMIN_EMAILS (nadie se adelanta a ponerse
 *     como super-admin: primero lo agrega el operador ahí), o
 *   - el correo ya pertenece a una organización (un super-admin no tiene
 *     membresía, E4).
 *
 * Uso (bash):
 *   NEW_PASSWORD='contraseña-nueva' node --env-file=.env scripts/platform-admin.mjs correo@ejemplo.com
 *
 * Uso (PowerShell):
 *   $env:NEW_PASSWORD='contraseña-nueva'; node --env-file=.env scripts/platform-admin.mjs correo@ejemplo.com
 *
 * Repetible: correrlo dos veces para el mismo correo solo actualiza la
 * contraseña y confirma `email_verified = true`.
 */
import { hashPassword } from "better-auth/crypto";
import { customAlphabet } from "nanoid";
import postgres from "postgres";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const MIN_PASSWORD_LENGTH = 8;

const emailArg = process.argv[2];
const password = process.env.NEW_PASSWORD;
const allowedRaw = process.env.PLATFORM_ADMIN_EMAILS;
const databaseUrl = process.env.DATABASE_URL;

if (!emailArg || !password) {
  console.error(
    "Faltan datos.\n" +
      "  bash:       NEW_PASSWORD='...' node --env-file=.env scripts/platform-admin.mjs correo@ejemplo.com\n" +
      "  PowerShell: $env:NEW_PASSWORD='...'; node --env-file=.env scripts/platform-admin.mjs correo@ejemplo.com"
  );
  process.exit(1);
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  process.exit(1);
}
if (!databaseUrl) {
  console.error("DATABASE_URL no está definida.");
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
const allowed = (allowedRaw ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter((e) => e.length > 0);

if (!allowed.includes(email)) {
  console.error(
    `«${email}» no está en PLATFORM_ADMIN_EMAILS. Agrégalo ahí primero (separado por` +
      " comas) y vuelve a correr este script."
  );
  process.exit(1);
}

const sql = postgres(databaseUrl, {
  max: 1,
  onnotice: () => {},
  connection: { TimeZone: "UTC" },
});

try {
  const existing = await sql`select id from "user" where lower(email) = ${email}`;

  if (existing.length > 0) {
    const userId = existing[0].id;
    const membership = await sql`select 1 from "member" where user_id = ${userId} limit 1`;
    if (membership.length > 0) {
      console.error(
        `«${email}» ya pertenece a una organización; un super-admin no tiene membresía (E4).`
      );
      process.exit(1);
    }

    const now = new Date();
    const hash = await hashPassword(password);
    await sql`update "user" set email_verified = true, updated_at = ${now} where id = ${userId}`;
    const account = await sql`select id from "account" where user_id = ${userId} and provider_id = 'credential' limit 1`;
    if (account.length > 0) {
      await sql`update "account" set password = ${hash}, updated_at = ${now} where id = ${account[0].id}`;
    } else {
      await sql`insert into "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
        values (${nano()}, ${userId}, 'credential', ${userId}, ${hash}, ${now}, ${now})`;
    }
    console.log(`Super-admin actualizado: ${email} (email_verified = true, contraseña reemplazada).`);
  } else {
    const now = new Date();
    const hash = await hashPassword(password);
    const userId = nano();
    await sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
      values (${userId}, 'Super-admin', ${email}, true, ${now}, ${now})`;
    await sql`insert into "account" (id, account_id, provider_id, user_id, password, created_at, updated_at)
      values (${nano()}, ${userId}, 'credential', ${userId}, ${hash}, ${now}, ${now})`;
    console.log(`Super-admin creado: ${email}. Entra en /login con esta contraseña.`);
  }
} finally {
  await sql.end();
}
