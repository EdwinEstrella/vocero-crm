"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * 020 (US5) — Confirmación de suspender: explica el efecto (sesiones
 * revocadas, webhooks descartados) antes de actuar. Reactivar no lleva
 * diálogo — no es destructivo y ya es idempotente.
 */
export function SuspendDialog({
  organizationName,
  onCancel,
  onConfirm,
}: {
  organizationName: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Suspender organización"
        className="w-full max-w-md rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">Suspender «{organizationName}»</h3>
        <p className="mb-4 text-xs text-text-3">
          Sus sesiones se cierran de inmediato; el siguiente login de un
          miembro se rechaza y los webhooks entrantes se descartan sin
          guardar nada (salvo el evento de conexión de WhatsApp). Lo
          descartado durante la suspensión no se recupera al reactivar.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="suspend-reason">Motivo (opcional, solo lo ves tú)</Label>
          <Textarea
            id="suspend-reason"
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Impago, abuso, solicitud del negocio…"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason.trim())}>
            Suspender
          </Button>
        </div>
      </div>
    </div>
  );
}
