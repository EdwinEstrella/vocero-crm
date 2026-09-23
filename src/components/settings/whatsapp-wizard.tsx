"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Info,
  ShieldCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Connection = {
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: "connected" | "reconnect_required";
  tokenLast4: string;
};

type WebhookInfo = {
  url: string;
  verifyToken: string;
  isHttps: boolean;
  signatureLayer: boolean;
};

type EmbeddedSignup = {
  appId: string;
  configId: string;
};

type CoexistenceStatus = {
  status: string;
  reason: string | null;
  expiresAt: string;
  phoneNumberId: string | null;
};

type FacebookSdk = {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>
  ) => void;
};

declare global {
  interface Window {
    FB?: FacebookSdk;
  }
}

function loadFacebookSdk(): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    const existing = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => (window.FB ? resolve(window.FB) : reject(new Error("Meta SDK unavailable"))), { once: true });
      existing.addEventListener("error", () => reject(new Error("Meta SDK unavailable")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = "facebook-jssdk";
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.onload = () => (window.FB ? resolve(window.FB) : reject(new Error("Meta SDK unavailable")));
    script.onerror = () => reject(new Error("Meta SDK unavailable"));
    document.head.appendChild(script);
  });
}

export function WhatsappWizard() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [webhook, setWebhook] = useState<WebhookInfo | null>(null);
  const [embeddedSignup, setEmbeddedSignup] = useState<EmbeddedSignup | null>(null);
  const [coexistence, setCoexistence] = useState<CoexistenceStatus | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refetch = useCallback(async () => {
    const [c, w] = await Promise.all([
      fetch("/api/settings/whatsapp").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/settings/webhook").then((r) => (r.ok ? r.json() : null)),
    ]).catch(() => [null, null]);
    if (c) {
      setConnection(c.connection);
      setEmbeddedSignup(c.embeddedSignup ?? null);
      setCoexistence(c.coexistence ?? null);
    }
    if (w) setWebhook(w);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  if (!loaded) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {connection?.status === "reconnect_required" && (
        <div className="flex items-start gap-2 rounded-lg border border-danger-soft bg-danger-tint p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-danger-text">
              El token de WhatsApp expiró o fue revocado.
            </p>
            <p className="text-danger-text opacity-80">
              Los envíos están pausados. Pega un token nuevo abajo y prueba la
              conexión para reconectar.
            </p>
          </div>
        </div>
      )}

      {connection && connection.status === "connected" && (
        <div className="flex items-center gap-3 rounded-lg border border-success-soft bg-success-tint p-4">
          <CheckCircle2 className="h-5 w-5 text-success" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-success-text">
              Número conectado: {connection.displayPhoneNumber ?? connection.phoneNumberId}
            </p>
            <p className="text-success-text opacity-80">
              {connection.verifiedName ? `${connection.verifiedName} · ` : ""}
              token …{connection.tokenLast4}
            </p>
          </div>
          <Badge variant="success">Conectado</Badge>
        </div>
      )}

      {embeddedSignup && (
        <EmbeddedSignupCard
          config={embeddedSignup}
          coexistence={coexistence}
          onChanged={() => void refetch()}
        />
      )}

      <ConnectForm existing={connection} onSaved={() => void refetch()} />

      {webhook && <WebhookCard webhook={webhook} />}
    </div>
  );
}

function EmbeddedSignupCard({
  config,
  coexistence,
  onChanged,
}: {
  config: EmbeddedSignup;
  coexistence: CoexistenceStatus | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setNotice(null);
    try {
      const startResponse = await fetch("/api/settings/whatsapp/start", { method: "POST" });
      const startData = (await startResponse.json().catch(() => null)) as {
        attempt?: { state: string };
        error?: { message?: string };
      } | null;
      if (!startResponse.ok || !startData?.attempt) {
        throw new Error(startData?.error?.message ?? "No se pudo iniciar la conexión con Meta");
      }
      const sdk = await loadFacebookSdk();
      sdk.init({ appId: config.appId, cookie: true, xfbml: false, version: "v25.0" });
      const completed = await new Promise<boolean>((resolve) => {
        sdk.login(
          (response) => resolve(Boolean(response.authResponse?.code)),
          {
            config_id: config.configId,
            response_type: "code",
            override_default_response_type: true,
            extras: {
              setup: {},
              featureType: "whatsapp_business_app_onboarding",
              sessionInfoVersion: "3",
            },
          }
        );
      });
      if (!completed) {
        setNotice("Meta cerró o rechazó el registro. Tu conexión actual no cambió.");
        return;
      }
      // The code is intentionally never displayed or persisted in the browser.
      // Asset IDs are not inferred from an unauthenticated postMessage payload.
      setNotice("Meta completó el paso del navegador. Espera la confirmación firmada antes de cambiar credenciales.");
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo cargar Embedded Signup");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/whatsapp/disconnect", { method: "POST" });
      const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(data?.error?.message ?? "No se pudo desconectar");
      setNotice("La conexión de coexistencia fue desconectada.");
      onChanged();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "No se pudo desconectar");
    } finally {
      setBusy(false);
    }
  }

  const terminal = coexistence?.status === "rejected" || coexistence?.status === "revoked" || coexistence?.status === "disconnected";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conectar con WhatsApp Business</CardTitle>
        <CardDescription>
          Conserva tu aplicación WhatsApp Business mientras Meta confirma la coexistencia. Solo el dueño de la organización puede iniciar o desconectar este flujo.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {coexistence && (
          <p className={terminal ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role="status">
            Estado: {coexistence.status}{coexistence.reason ? ` — ${coexistence.reason}` : ""}
          </p>
        )}
        {notice && <p className="text-sm text-muted-foreground" role="status">{notice}</p>}
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void start()}>
            {busy ? "Abriendo Meta…" : "Conectar con Meta"}
          </Button>
          {coexistence && (
            <Button variant="outline" disabled={busy} onClick={() => void disconnect()}>
              Desconectar coexistencia
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Por seguridad, Vocero no toma IDs de activos ni credenciales desde mensajes del navegador. La activación requiere la confirmación firmada de Meta.
        </p>
      </CardContent>
    </Card>
  );
}

function ConnectForm({
  existing,
  onSaved,
}: {
  existing: Connection | null;
  onSaved: () => void;
}) {
  const [wabaId, setWabaId] = useState(existing?.wabaId ?? "");
  const [phoneNumberId, setPhoneNumberId] = useState(
    existing?.phoneNumberId ?? ""
  );
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<
    | { ok: true; display: string }
    | { ok: false; message: string }
    | null
  >(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canTest = wabaId.trim() && phoneNumberId.trim() && token.trim();

  async function test() {
    setTesting(true);
    setTestResult(null);
    const res = await fetch("/api/settings/whatsapp/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phoneNumberId, token }),
    }).catch(() => null);
    setTesting(false);
    if (!res) {
      setTestResult({ ok: false, message: "Sin conexión con el servidor" });
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      displayPhoneNumber?: string;
      error?: { message?: string };
    } | null;
    if (res.ok && data?.displayPhoneNumber) {
      setTestResult({ ok: true, display: data.displayPhoneNumber });
    } else {
      setTestResult({
        ok: false,
        message: data?.error?.message ?? "La validación falló",
      });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    const res = await fetch("/api/settings/whatsapp", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wabaId, phoneNumberId, token }),
    }).catch(() => null);
    setSaving(false);
    if (!res?.ok) {
      const data = (await res?.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setSaveError(data?.error?.message ?? "No se pudo guardar la conexión");
      return;
    }
    setToken("");
    setTestResult(null);
    onSaved();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {existing ? "Reconectar / actualizar el número" : "Conectar tu número de WhatsApp"}
        </CardTitle>
        <CardDescription>
          Pega las credenciales de WhatsApp Cloud API. El token se valida
          contra Meta ANTES de guardarse y se almacena cifrado.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 rounded-md border bg-background p-4 text-sm">
          <p className="font-medium">¿De dónde sale el token?</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo directo</p>
              <p className="text-muted-foreground">
                El negocio tiene su propia app en{" "}
                <span className="text-foreground">developers.facebook.com</span>:
                usa un token de <span className="text-foreground">usuario del sistema</span>{" "}
                (no expira) con permisos de WhatsApp. En este modo conviene
                configurar también el App Secret para la firma del webhook.
              </p>
            </div>
            <div className="rounded-md border p-3">
              <p className="mb-1 font-medium text-primary">Modo agencia (Tech Provider)</p>
              <p className="text-muted-foreground">
                Tu agencia hace el Embedded Signup en SU plataforma y su
                backend obtiene el token del cliente; te lo entrega para
                pegarlo aquí. El webhook se conecta con el{" "}
                <span className="text-foreground">override por WABA</span>{" "}
                (checklist de 5 pasos en el README).
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="waba-id">WABA ID</Label>
            <Input
              id="waba-id"
              placeholder="ID de la cuenta de WhatsApp Business"
              value={wabaId}
              onChange={(e) => setWabaId(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone-number-id">Phone Number ID</Label>
            <Input
              id="phone-number-id"
              placeholder="ID del número de teléfono"
              value={phoneNumberId}
              onChange={(e) => setPhoneNumberId(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="token">Token de acceso</Label>
          <Input
            id="token"
            type="password"
            placeholder={existing ? `Guardado (…${existing.tokenLast4}) — pega uno nuevo para cambiarlo` : "EAAG…"}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setTestResult(null);
            }}
          />
        </div>

        {testResult && (
          <p
            className={`text-sm ${testResult.ok ? "text-success" : "text-destructive"}`}
          >
            {testResult.ok
              ? `✓ Token válido para ${testResult.display}. Ya puedes guardar.`
              : testResult.message}
          </p>
        )}
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={!canTest || testing}
            onClick={() => void test()}
          >
            {testing ? "Probando…" : "Probar conexión"}
          </Button>
          <Button
            disabled={!testResult?.ok || saving}
            onClick={() => void save()}
          >
            {saving ? "Guardando…" : "Guardar conexión"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookCard({ webhook }: { webhook: WebhookInfo }) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(text: string, which: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook de WhatsApp</CardTitle>
        <CardDescription>
          Pega estos valores en el panel de Meta (modo directo) o úsalos en el
          override de tu backend de agencia (a nivel WABA).{" "}
          <strong className="text-foreground">
            Guarda la conexión ANTES de configurar el webhook:
          </strong>{" "}
          la verificación (handshake) funciona sin guardar, pero los mensajes
          solo se reciben si la conexión está guardada — se enrutan por tu
          Phone Number ID.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!webhook.isHttps && (
          <p className="flex items-start gap-2 rounded-md border border-warning-soft bg-warning-tint p-3 text-xs text-warning-text">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            La URL configurada no es https: Meta exige https para los webhooks.
            Ajusta APP_BASE_URL con tu dominio público.
          </p>
        )}
        <div className="space-y-1.5">
          <Label>URL del webhook (callback URL)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs">
              {webhook.url}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar URL"
              onClick={() => copy(webhook.url, "url")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "url" && (
              <span className="text-xs text-primary">Copiada ✓</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            La URL contiene el token secreto en la ruta: trátala como una
            contraseña.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label>Verify token</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2 text-xs">
              {webhook.verifyToken}
            </code>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copiar verify token"
              onClick={() => copy(webhook.verifyToken, "vt")}
            >
              <Copy className="h-4 w-4" />
            </Button>
            {copied === "vt" && (
              <span className="text-xs text-primary">Copiado ✓</span>
            )}
          </div>
        </div>
        {webhook.signatureLayer ? (
          <p className="flex items-center gap-2 text-xs text-success">
            <ShieldCheck className="h-4 w-4" /> Verificación de firma activa
            (META_APP_SECRET configurado): cada evento se valida con
            x-hub-signature-256.
          </p>
        ) : (
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" /> Sin App Secret
            configurado: el webhook queda protegido por la URL secreta (normal
            en modo agencia). Para la capa extra de firma, agrega
            META_APP_SECRET a la instancia.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
