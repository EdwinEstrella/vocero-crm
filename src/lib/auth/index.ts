import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AUTH_RATE_LIMIT, checkRateLimit, clientIp } from "@/lib/rate-limit";
import { onUserCreated, resolveMembership } from "@/server/auth/on-signup";
import { isReservedPlatformEmail } from "@/server/auth/registration";

/**
 * Contexto interno del proceso: permite que el alta de cuentas de equipo
 * (owner → API) atraviese el gate de registro cerrado. No es alcanzable
 * desde fuera: solo envuelve llamadas server-side.
 */
const globalForSignup = globalThis as unknown as {
  __voceroInternalSignup?: AsyncLocalStorage<boolean>;
};

// En globalThis: los módulos pueden evaluarse más de una vez (una por ruta en
// dev) y todas las copias deben compartir el mismo contexto.
function internalSignupContext(): AsyncLocalStorage<boolean> {
  if (!globalForSignup.__voceroInternalSignup) {
    globalForSignup.__voceroInternalSignup = new AsyncLocalStorage<boolean>();
  }
  return globalForSignup.__voceroInternalSignup;
}

export function runInternalSignup<T>(fn: () => Promise<T>): Promise<T> {
  return internalSignupContext().run(true, fn);
}

function isInternalSignup(): boolean {
  return internalSignupContext().getStore() === true;
}

const RATE_LIMITED_PATHS = new Set(["/sign-in/email", "/sign-up/email"]);

/**
 * 020 (FR-004) — Rechaza CUALQUIER `/sign-up/email` (público o interno, vía
 * `runInternalSignup`: cuentas de equipo) cuyo correo esté reservado para el
 * super-admin. Antes solo se aplicaba al alta pública: un owner podía
 * "apropiarse" del correo reservado creando una cuenta de equipo con él, y
 * luego `scripts/platform-admin.mjs` rechazaba al super-admin real con "ya
 * pertenece a una organización". El script del operador no pasa por Better
 * Auth (SQL directo) y sigue funcionando igual. Exportada para poder probarla
 * sin levantar la instancia completa de Better Auth.
 */
export function assertSignUpEmailAllowed(path: string, body: unknown): void {
  if (path !== "/sign-up/email") return;
  const email = (body as { email?: string } | undefined)?.email;
  if (typeof email === "string" && isReservedPlatformEmail(email)) {
    throw new APIError("FORBIDDEN", { message: "correo_reservado" });
  }
}

function createAuth() {
  const env = getEnv();
  return betterAuth({
    baseURL: env.APP_BASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        organization: schema.organization,
        member: schema.member,
        invitation: schema.invitation,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
    },
    plugins: [organization({ creatorRole: "owner" })],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Rate limit por IP en login/registro (FR-062): 10 / 10 min → 429.
        if (RATE_LIMITED_PATHS.has(ctx.path)) {
          const ip = clientIp(ctx.headers);
          const result = checkRateLimit(`${ctx.path}:${ip}`, AUTH_RATE_LIMIT);
          if (!result.allowed) {
            throw new APIError("TOO_MANY_REQUESTS", {
              message: "Demasiados intentos; espera unos minutos",
            });
          }
        }
        // 020 — Registro público SIEMPRE abierto (D2); solo se rechaza el
        // correo reservado para el super-admin (FR-004), sin excepción para
        // una alta interna (ver `assertSignUpEmailAllowed`).
        assertSignUpEmailAllowed(ctx.path, ctx.body);
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await onUserCreated(user.id, user.name, {
              internal: isInternalSignup(),
            });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const membership = await resolveMembership(session.userId);
            if (membership?.suspendedAt) {
              throw new APIError("FORBIDDEN", {
                message: "Tu cuenta está suspendida; contacta a soporte",
              });
            }
            return {
              data: {
                ...session,
                activeOrganizationId: membership?.organizationId ?? null,
              },
            };
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __voceroAuth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.__voceroAuth) globalForAuth.__voceroAuth = createAuth();
  return globalForAuth.__voceroAuth;
}
