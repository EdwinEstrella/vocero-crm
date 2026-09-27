import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listPlatformEvents } from "@/server/platform/audit";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  org_suspended: "Suspendida",
  org_reactivated: "Reactivada",
  org_deleted: "Borrada",
  impersonation_started: "Suplantación iniciada",
  impersonation_ended: "Suplantación terminada",
};

type Params = { params: Promise<{ id: string }>; searchParams: Promise<{ name?: string }> };

/** 020 (US4/FR-032) — Detalle de una organización: su rastro de auditoría. */
export default async function AdminOrganizationDetailPage({ params, searchParams }: Params) {
  const { id } = await params;
  const { name } = await searchParams;
  const { events } = await listPlatformEvents({ organizationId: id });

  return (
    <div className="space-y-4">
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm text-text-3 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Organizaciones
      </Link>
      <div>
        <h1 className="text-lg font-semibold">{name ?? id}</h1>
        <p className="text-xs text-text-3">{id}</p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-text-3">
          Auditoría
        </p>
        {events.length === 0 && (
          <p className="text-sm text-text-3">Sin eventos registrados todavía.</p>
        )}
        {events.map((e) => (
          <div key={e.id} className="rounded-lg border bg-card px-4 py-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{ACTION_LABEL[e.action] ?? e.action}</span>
              <span className="text-xs text-text-3">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="mt-1 text-xs text-text-3">{e.actorEmail}</p>
            {Object.keys(e.metadata).length > 0 && (
              <pre className="mt-1 overflow-x-auto rounded bg-subtle px-2 py-1 text-[11px] text-text-3">
                {JSON.stringify(e.metadata)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
