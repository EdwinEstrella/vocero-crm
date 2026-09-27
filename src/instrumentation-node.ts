import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { isWhatsappEmbeddedSignupEnabled } from "@/lib/env";
import { drainCoexistenceDeliveries } from "@/server/whatsapp/sync-worker";

/**
 * 008 — Aviso al arranque si MEDIA_DIR no es escribible. Sin esto, el primer
 * síntoma era un 500 al subir el logo o el icono, o adjuntos entrantes "no
 * disponibles" (se reintentan al abrirlos, pero solo mientras Meta los
 * conserve), con el EACCES enterrado en el log de un request. Se prueba
 * escribiendo de verdad (lo mismo que hará saveMediaFile) y nunca tumba el
 * arranque: el resto del CRM funciona sin adjuntos.
 */
export async function checkMediaDir(): Promise<void> {
  let dir: string;
  try {
    dir = path.resolve(getEnv().MEDIA_DIR);
  } catch {
    return; // entorno inválido: lo reporta, con detalle, el primer getEnv() de la app
  }
  const probe = path.join(dir, `.prueba-escritura-${process.pid}`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(probe, "");
    await rm(probe, { force: true }).catch(() => {});
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? String(err);
    console.error(
      `[boot] MEDIA_DIR=${dir} no es escribible (${code}): los adjuntos entrantes, el logo y el icono NO se van a poder guardar. ` +
        "En Docker: monta un volumen persistente en /data (la imagen ya usa /data/media) y arranca el contenedor como root —el default—, " +
        "que el entrypoint le da el volumen al usuario de la app. Fuera de Docker: apunta MEDIA_DIR a un directorio escribible."
    );
  }
}

/**
 * Limpieza al arranque (FR-034): corridas del Laboratorio que quedaron
 * "running" tras un reinicio → fallidas. Solo corre en el runtime Node.
 */
export async function cleanupOrphanRuns(): Promise<void> {
  try {
    const db = getDb();
    const updated = await db
      .update(schema.agentTestRun)
      .set({
        status: "failed",
        error: "Interrumpida por un reinicio del servidor",
        finishedAt: new Date(),
      })
      .where(eq(schema.agentTestRun.status, "running"))
      .returning({ id: schema.agentTestRun.id });
    if (updated.length > 0) {
      console.log(
        `[boot] ${updated.length} corrida(s) del Laboratorio huérfana(s) marcada(s) como fallida(s)`
      );
    }
  } catch (err) {
    // La BD puede no estar lista aún (migraciones corren antes del server).
    console.error("[boot] limpieza de corridas huérfanas falló:", err);
  }
}

/**
 * 020 (E1/FR-023) — `BOT_API_KEY` (una clave global por variable de entorno)
 * ya NO se acepta: con N organizaciones no hay "la" instancia a la que
 * asignársela. Solo se avisa en el log, sin imprimir su valor — el operador
 * debe migrar a la clave por organización de Ajustes → API.
 */
export function warnIfLegacyBotApiKeyConfigured(): void {
  if (process.env.BOT_API_KEY) {
    console.warn(
      "[boot] BOT_API_KEY está definida pero ya NO se acepta (020): genera la " +
        "clave de cada organización en Ajustes → API y retira esta variable."
    );
  }
}

/** One bounded in-process coexistence drain per process; failures stay observable in the inbox. */
export function startCoexistenceWorker(): void {
  if (!isWhatsappEmbeddedSignupEnabled()) return;
  const timer = setInterval(() => {
    void drainCoexistenceDeliveries().catch((error) =>
      console.error("[coexistence] inbox drainer failed:", error)
    );
  }, 5_000);
  timer.unref();
  void drainCoexistenceDeliveries().catch((error) =>
    console.error("[coexistence] initial inbox drain failed:", error)
  );
}
