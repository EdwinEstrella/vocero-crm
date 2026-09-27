"use client";

import { useState } from "react";
import { LogOut, ShieldAlert } from "lucide-react";

/**
 * 020 (US7/FR-033) — Aviso fijo mientras el super-admin ve la app "como
 * soporte". Nunca se puede confundir con la app normal: color de alerta,
 * siempre visible, con salida de un clic.
 */
export function ImpersonationBanner({
  organizationName,
  suspended,
}: {
  organizationName: string;
  suspended: boolean;
}) {
  const [busy, setBusy] = useState(false);

  async function exit() {
    setBusy(true);
    const res = await fetch("/api/platform/impersonation", { method: "DELETE" }).catch(
      () => null
    );
    const data = (await res?.json().catch(() => null)) as { redirect?: string } | null;
    window.location.href = data?.redirect ?? "/admin";
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-warning-tint px-4 py-1.5 text-[13px] text-warning-text">
      <span className="flex items-center gap-1.5">
        <ShieldAlert className="h-3.5 w-3.5" strokeWidth={1.7} />
        Estás viendo «{organizationName}» como soporte
        {suspended ? " · suspendida" : ""}
      </span>
      <button
        disabled={busy}
        onClick={() => void exit()}
        className="flex items-center gap-1 rounded px-2 py-0.5 font-medium hover:bg-warning-soft"
      >
        <LogOut className="h-3.5 w-3.5" />
        Salir
      </button>
    </div>
  );
}
