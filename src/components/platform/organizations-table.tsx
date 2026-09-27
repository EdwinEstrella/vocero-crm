"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ImpersonateButton } from "@/components/platform/impersonate-button";
import { SuspendDialog } from "@/components/platform/suspend-dialog";
import { DeleteDialog } from "@/components/platform/delete-dialog";

type OrganizationRow = {
  id: string;
  name: string;
  ownerEmail: string | null;
  createdAt: string;
  suspendedAt: string | null;
  whatsapp: "connected" | "reconnect_required" | "none";
  coexistence: string;
  contacts: number;
  messages: number;
  lastActivityAt: string | null;
};

type ListResponse = {
  page: number;
  pageSize: number;
  total: number;
  organizations: OrganizationRow[];
};

const WHATSAPP_LABEL: Record<OrganizationRow["whatsapp"], string> = {
  connected: "Conectado",
  reconnect_required: "Reconectar",
  none: "Sin conectar",
};

const COEXISTENCE_LABEL: Record<string, string> = {
  pending: "Pendiente",
  awaiting_confirmation: "Esperando confirmación",
  active: "Activo",
  rejected: "Rechazado",
  revoked: "Revocado",
  disconnected: "Desconectado",
  none: "—",
};

/** 020 (US4/D3) — Lista del panel de super-admin: buscar, suspender/reactivar,
 *  borrar y suplantar, todo desde una fila. */
export function OrganizationsTable() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<OrganizationRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrganizationRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q.trim()) params.set("q", q.trim());
    params.set("page", String(page));
    const res = await fetch(`/api/platform/organizations?${params}`).catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      setError("No se pudo cargar la lista");
      return;
    }
    setError(null);
    setData((await res.json()) as ListResponse);
  }, [q, page]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function suspend(org: OrganizationRow, reason: string) {
    setBusyId(org.id);
    await fetch(`/api/platform/organizations/${org.id}/suspend`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    }).catch(() => null);
    setBusyId(null);
    setSuspendTarget(null);
    void refetch();
  }

  async function reactivate(org: OrganizationRow) {
    setBusyId(org.id);
    await fetch(`/api/platform/organizations/${org.id}/reactivate`, {
      method: "POST",
    }).catch(() => null);
    setBusyId(null);
    void refetch();
  }

  async function remove(org: OrganizationRow) {
    setBusyId(org.id);
    const res = await fetch(`/api/platform/organizations/${org.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmName: org.name }),
    }).catch(() => null);
    setBusyId(null);
    setDeleteTarget(null);
    if (res?.ok) void refetch();
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3" />
          <Input
            value={q}
            onChange={(e) => {
              setPage(1);
              setQ(e.target.value);
            }}
            placeholder="Buscar por nombre o correo del owner"
            className="pl-9"
          />
        </div>
        {data && (
          <p className="text-xs text-text-3">{data.total} organizaciones</p>
        )}
      </div>

      {error && <p className="text-sm text-danger-text">{error}</p>}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b bg-subtle text-left text-xs uppercase tracking-wide text-text-3">
            <tr>
              <th className="px-3 py-2 font-medium">Organización</th>
              <th className="px-3 py-2 font-medium">Owner</th>
              <th className="px-3 py-2 font-medium">WhatsApp</th>
              <th className="px-3 py-2 font-medium">Coexistence</th>
              <th className="px-3 py-2 font-medium">Contactos</th>
              <th className="px-3 py-2 font-medium">Mensajes</th>
              <th className="px-3 py-2 font-medium">Última actividad</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {!loading && data?.organizations.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-text-3">
                  Sin resultados.
                </td>
              </tr>
            )}
            {data?.organizations.map((org) => (
              <tr key={org.id} className="border-b last:border-0">
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/${org.id}?name=${encodeURIComponent(org.name)}`}
                    className="font-medium hover:underline"
                  >
                    {org.name}
                  </Link>
                  <p className="text-[11px] text-text-3">
                    Alta {new Date(org.createdAt).toLocaleDateString()}
                  </p>
                </td>
                <td className="px-3 py-2 text-text-2">{org.ownerEmail ?? "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={org.whatsapp === "connected" ? "success" : org.whatsapp === "reconnect_required" ? "warning" : "secondary"}>
                    {WHATSAPP_LABEL[org.whatsapp]}
                  </Badge>
                </td>
                <td className="px-3 py-2">
                  <Badge variant={org.coexistence === "active" ? "success" : "secondary"}>
                    {COEXISTENCE_LABEL[org.coexistence] ?? org.coexistence}
                  </Badge>
                </td>
                <td className="px-3 py-2">{org.contacts}</td>
                <td className="px-3 py-2">{org.messages}</td>
                <td className="px-3 py-2 text-text-3">
                  {org.lastActivityAt
                    ? new Date(org.lastActivityAt).toLocaleString()
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {org.suspendedAt ? (
                    <Badge variant="destructive">Suspendida</Badge>
                  ) : (
                    <Badge variant="success">Activa</Badge>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ImpersonateButton organizationId={org.id} />
                    {org.suspendedAt ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === org.id}
                        onClick={() => void reactivate(org)}
                      >
                        Reactivar
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === org.id}
                        onClick={() => setSuspendTarget(org)}
                      >
                        Suspender
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busyId === org.id}
                      onClick={() => setDeleteTarget(org)}
                    >
                      Borrar
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Anterior
          </Button>
          <span className="text-text-3">
            Página {data.page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}

      {suspendTarget && (
        <SuspendDialog
          organizationName={suspendTarget.name}
          onCancel={() => setSuspendTarget(null)}
          onConfirm={(reason) => void suspend(suspendTarget, reason)}
        />
      )}
      {deleteTarget && (
        <DeleteDialog
          organizationName={deleteTarget.name}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void remove(deleteTarget)}
        />
      )}
    </div>
  );
}
