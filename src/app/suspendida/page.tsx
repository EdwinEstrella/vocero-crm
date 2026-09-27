import { SuspendedNotice } from "@/components/platform/suspended-notice";

export const dynamic = "force-dynamic";

/**
 * 020 (US5/FR-006) — A donde cae un miembro de una organización suspendida.
 * Sin gate de sesión propio: sus sesiones ya se revocaron al suspender, así
 * que casi siempre llega aquí sin ninguna válida.
 */
export default function SuspendidaPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-subtle p-4">
      <SuspendedNotice />
    </main>
  );
}
