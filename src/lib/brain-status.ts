/**
 * «Quién responde a tus clientes»: el contrato entre
 * `GET /api/agent/brain-status` y la UI (la tarjeta del Agente y el panel de
 * contacto). Solo tipos y textos: lo importan componentes de cliente, así que
 * aquí no entra nada de servidor. El cálculo vive en `server/bot/status.ts`.
 *
 * Por qué existe: el agente incluido y un cerebro externo (Nea) no se ven
 * entre sí. Si los dos están activos, el cliente recibe DOS respuestas
 * distintas al mismo mensaje, y hasta ahora nada en el CRM lo decía.
 */

/** Los modos de Nea tal como los reporta su `/health`. */
export const BRAIN_MODES = ["estándar", "cloud", "multiorg"] as const;
export type BrainMode = (typeof BRAIN_MODES)[number];

/** Por qué el `/health` del cerebro externo no cuenta como «en línea». */
export type BrainHealthProblem =
  /** No contestó dentro del límite (2 s). */
  | "timeout"
  /** No se pudo conectar: nombre que no resuelve, puerto cerrado… */
  | "network"
  /** Contestó con un código distinto de 200 (`httpStatus`). */
  | "status"
  /** Contestó con una redirección; no se sigue. */
  | "redirect"
  /** 200, pero sin JSON o sin decir que está sano. */
  | "invalid"
  /** `BRAIN_HEALTH_URL` no es una URL http(s): no se le preguntó a nadie. */
  | "config";

/** La cola de Nea hacia el CRM (el «relevo» de los webhooks). */
export type BrainRelayDto = {
  /** Mensajes entrantes que esperan llegar al CRM. */
  pendientes: number | null;
  masViejoSegundos: number | null;
  ultimoErrorEn: string | null;
};

export type BrainHealthDto = {
  reachable: boolean;
  /** Solo host[:puerto]: jamás credenciales, ruta ni query de la URL. */
  host: string;
  checkedAt: string;
  problem?: BrainHealthProblem;
  httpStatus?: number;
  version?: string;
  commit?: string;
  commitVerified?: boolean;
  mode?: BrainMode;
  relay?: BrainRelayDto;
};

export type BrainWarning = "doble_respuesta" | "sin_cerebro";

export type BrainStatusDto = {
  embedded: {
    /** La instancia tiene token de IA (`OPENROUTER_API_TOKEN`). */
    configured: boolean;
    /** El interruptor del Agente. */
    enabled: boolean;
    answering: boolean;
  };
  external: {
    /** `BOT_API_KEY` válida: la API `/api/bot/*` está abierta. */
    keyConfigured: boolean;
    /** Última llamada autenticada a `/api/bot/*`. En memoria: se cuenta
     *  desde el último arranque del CRM. */
    lastSeenAt: string | null;
    /** Parece estar contestando: llamó en las últimas 24 h o su `/health`
     *  está en línea. */
    active: boolean;
    /** `null` si no hay `BRAIN_HEALTH_URL`: no se le pregunta a nadie. */
    health: BrainHealthDto | null;
  };
  warning: BrainWarning | null;
};

/**
 * El nombre que se puede afirmar. «Nea» solo si su `/health` habla el
 * contrato de Nea (trae `mode`); con un bot propio o una Nea vieja no se
 * inventa ninguno.
 */
export function externalBrainName(status: BrainStatusDto): string | null {
  return status.external.health?.mode ? "Nea" : null;
}

/**
 * Hasta donde el CRM puede saber, el cerebro externo está contestando: está
 * activo y, si se le pregunta a su `/health`, no está caído. `active` a secas
 * sirve para el aviso de doble respuesta (mejor avisar de más); para decirle
 * al dueño «responde tu cerebro externo» hace falta esto.
 */
export function externalAnswering(status: BrainStatusDto): boolean {
  const h = status.external.health;
  return status.external.active && (!healthKnown(h) || h.reachable);
}

/** Se le pregunta a su `/health` y no está en línea. */
export function externalDown(status: BrainStatusDto): boolean {
  const h = status.external.health;
  return healthKnown(h) && !h.reachable;
}

/** Su `/health` dice algo. Con `BRAIN_HEALTH_URL` mal escrita no se le pudo
 *  preguntar: no se sabe si está en línea, y se juzga como si no hubiera URL
 *  (por su última llamada), no como caído. */
function healthKnown(h: BrainHealthDto | null): h is BrainHealthDto {
  return h !== null && h.problem !== "config";
}

/** «Responde tu cerebro externo (Nea)», o sin paréntesis si no se sabe quién es. */
export function externalAnswerLabel(status: BrainStatusDto): string {
  const name = externalBrainName(status);
  return name
    ? `Responde tu cerebro externo (${name})`
    : "Responde tu cerebro externo";
}

/** «hace 3 min». Tolera relojes desfasados: el futuro es «hace unos segundos». */
export function haceCuanto(iso: string, now: number = Date.now()): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s) || s < 60) return "hace unos segundos";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}
