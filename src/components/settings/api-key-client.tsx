"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ApiKeyView = {
  id: string;
  last4: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/**
 * 020 — Ajustes → API: la clave POR ORGANIZACIÓN del cerebro externo
 * (contracts/api-key.md). El secreto en claro solo aparece UNA vez, justo
 * después de generar o rotar; después solo se ven los últimos 4, la fecha de
 * creación y el último uso.
 */
export function ApiKeyClient() {
  const [apiKey, setApiKey] = useState<ApiKeyView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refetch = useCallback(async () => {
    const res = await fetch("/api/settings/api-key").catch(() => null);
    if (res?.ok) {
      const data = (await res.json()) as { apiKey: ApiKeyView | null };
      setApiKey(data.apiKey);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function issue() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/api-key", { method: "POST" }).catch(
      () => null
    );
    setBusy(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setError(data?.error?.message ?? "No se pudo generar la clave");
      return;
    }
    const data = (await res.json()) as { apiKey: ApiKeyView; secret: string };
    setApiKey(data.apiKey);
    setSecret(data.secret);
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/settings/api-key", { method: "DELETE" }).catch(
      () => null
    );
    setBusy(false);
    if (!res?.ok) {
      setError("No se pudo revocar la clave");
      return;
    }
    setApiKey(null);
    setSecret(null);
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // sin portapapeles (contexto no seguro): el texto sigue visible
    }
  }

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Clave de API para tu cerebro externo</CardTitle>
          <CardDescription>
            Conecta tu propio bot a <code>/api/bot/*</code> sin que el token de
            WhatsApp salga del CRM. La clave es SOLO de tu organización.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {secret && (
            <div className="space-y-1.5 rounded-md border border-warning-soft bg-warning-tint p-3">
              <Label htmlFor="api-key-secret">
                Tu clave — cópiala ahora, no se vuelve a mostrar
              </Label>
              <div className="flex gap-2">
                <Input
                  id="api-key-secret"
                  readOnly
                  value={secret}
                  className="font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="icon"
                  type="button"
                  aria-label="Copiar la clave"
                  onClick={() => void copySecret()}
                >
                  {copied ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          )}

          {apiKey ? (
            <div className="space-y-1 text-sm">
              <p>
                Clave activa: <code>vk_…{apiKey.last4}</code>
              </p>
              <p className="text-xs text-muted-foreground">
                Creada el {new Date(apiKey.createdAt).toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">
                Último uso:{" "}
                {apiKey.lastUsedAt
                  ? new Date(apiKey.lastUsedAt).toLocaleString()
                  : "nunca"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sin clave activa: <code>/api/bot/*</code> responde 401 a esta
              organización.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void issue()}>
              <KeyRound className="h-4 w-4" />
              {apiKey ? "Rotar" : "Generar"}
            </Button>
            {apiKey && (
              <Button variant="outline" disabled={busy} onClick={() => void revoke()}>
                Revocar
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
