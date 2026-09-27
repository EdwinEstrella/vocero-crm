"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 020 (US7/D3) — "Entrar como soporte": arranca la suplantación y navega de
 * lleno a `/inbox` — es un cambio de organización efectiva del admin, así
 * que hace falta una recarga completa (no un `router.push`).
 */
export function ImpersonateButton({ organizationId }: { organizationId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/platform/impersonation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId }),
    }).catch(() => null);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo entrar como soporte");
      setBusy(false);
      return;
    }
    const data = (await res.json()) as { redirect: string };
    window.location.href = data.redirect;
  }

  return (
    <div className="inline-flex flex-col items-start">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => void start()}>
        <LogIn className="h-3.5 w-3.5" />
        Entrar como soporte
      </Button>
      {error && <p className="mt-1 text-[11px] text-danger-text">{error}</p>}
    </div>
  );
}
