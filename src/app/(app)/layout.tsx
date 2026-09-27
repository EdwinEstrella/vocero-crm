import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import {
  PlatformAdminWithoutImpersonationError,
  requireSession,
  SuspendedOrganizationError,
  UnauthorizedError,
  type SessionContext,
} from "@/lib/auth/session";
import { normalizeThemePreference, THEME_COOKIE } from "@/lib/theme";
import { getBranding } from "@/server/branding";
import { AppShell } from "@/components/app-shell";
import { resolveCommit } from "@/lib/version";
import { agendaEnabled } from "@/server/agenda/flag";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let session: SessionContext;
  try {
    session = await requireSession();
  } catch (err) {
    // 020 — un super-admin sin suplantación activa no tiene organización que
    // ver aquí: va a su panel, no a /login (FR-030, edge case de la spec).
    if (err instanceof PlatformAdminWithoutImpersonationError) redirect("/admin");
    // 020 — la organización de este usuario está suspendida (FR-005/006).
    if (err instanceof SuspendedOrganizationError) redirect("/suspendida");
    if (err instanceof UnauthorizedError) redirect("/login");
    throw err;
  }

  const branding = await getBranding(session.organizationId);
  const authSession = await getAuth().api.getSession({
    headers: await headers(),
  });
  const theme = normalizeThemePreference(
    (await cookies()).get(THEME_COOKIE)?.value
  );

  return (
    <AppShell
      branding={branding}
      userName={authSession?.user.name ?? "Usuario"}
      role={session.role}
      theme={theme}
      // Se resuelve aquí, en el servidor: el cliente no ve `SOURCE_COMMIT`.
      // Baja con su procedencia, para que la insignia no presente como
      // verificado un commit que no salió del build (#50).
      commit={resolveCommit()}
      // Qué módulos opcionales existen se decide en el servidor y baja por
      // prop, igual que los canales de la Bandeja. El nav es un componente de
      // cliente: no puede —ni debe— leer variables de entorno.
      agenda={agendaEnabled()}
      // 020 — aviso fijo mientras un super-admin ve esta organización como
      // soporte (E6/FR-033); null en una sesión normal.
      impersonation={session.impersonation}
    >
      {children}
    </AppShell>
  );
}
