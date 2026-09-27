import { notFound } from "next/navigation";
import { NotPlatformAdminError, requirePlatformAdmin } from "@/server/platform/admins";
import { AdminHeader } from "@/components/platform/admin-header";

export const dynamic = "force-dynamic";

/**
 * 020 (D3/FR-030) — Panel de super-admin: layout PROPIO, sin la navegación de
 * la app (nada de organizationId de tenant por aquí). El gate se comprueba en
 * el servidor en CADA request: cualquiera que no sea super-admin recibe
 * `notFound()` — la superficie no existe para quien no es super-admin.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let email: string;
  try {
    email = (await requirePlatformAdmin()).email;
  } catch (err) {
    if (err instanceof NotPlatformAdminError) notFound();
    throw err;
  }

  return (
    <div className="min-h-screen bg-subtle">
      <AdminHeader email={email} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
