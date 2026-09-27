"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * 020 (US6-1) — Borrado irreversible: el botón solo se habilita cuando el
 * texto coincide EXACTAMENTE con el nombre de la organización (comparación
 * sin normalizar, igual que la API).
 */
export function DeleteDialog({
  organizationName,
  onCancel,
  onConfirm,
}: {
  organizationName: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const matches = typed === organizationName;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-label="Borrar organización"
        className="w-full max-w-md rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold text-danger-text">
          Borrar «{organizationName}»
        </h3>
        <p className="mb-4 text-xs text-text-3">
          Esto es IRREVERSIBLE: se borran sus contactos, conversaciones,
          mensajes, leads, citas, credenciales de WhatsApp y claves de API, sus
          archivos, y las cuentas de equipo que no pertenecen a ninguna otra
          organización. Se intenta desuscribir la App de su WABA.
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="delete-confirm-name">
            Escribe el nombre exacto para confirmar
          </Label>
          <Input
            id="delete-confirm-name"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={organizationName}
            autoComplete="off"
          />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={!matches} onClick={onConfirm}>
            Borrar definitivamente
          </Button>
        </div>
      </div>
    </div>
  );
}
