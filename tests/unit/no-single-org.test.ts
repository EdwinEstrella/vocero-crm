import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 020 (FR-010, SC-004) — Guardarraíl: ningún módulo fuera de
 * `src/server/platform/` resuelve "la" organización sin un tenant derivado
 * de la petición. Con N organizaciones, `from(schema.organization).limit(1)`
 * sin un `.where(` de por medio siempre trae la organización de OTRO
 * negocio, nunca la del que llamó.
 *
 * Este test escanea el código fuente y falla si aparece ese patrón fuera de
 * la excepción constitucional (`src/server/platform/`, el único módulo con
 * lectura entre tenants, detrás del gate de super-admin).
 */

const SRC = path.resolve(import.meta.dirname, "..", "..", "src");
const EXCEPCION = path.join("server", "platform");

function archivosTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...archivosTs(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Trozo que sigue a cada `.from(schema.organization)`, donde vive el resto de la query. */
function bloquesDeFrom(code: string): string[] {
  const bloques: string[] = [];
  const re = /\.from\(\s*schema\.organization\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(code)) !== null) {
    bloques.push(code.slice(match.index, match.index + 400));
  }
  return bloques;
}

/** `.limit(1)` sin un `.where(` ANTES de llegar a él, en el mismo bloque. */
function esFallbackSinTenant(bloque: string): boolean {
  const limitIdx = bloque.indexOf(".limit(1)");
  if (limitIdx === -1) return false;
  const whereIdx = bloque.indexOf(".where(");
  return whereIdx === -1 || whereIdx > limitIdx;
}

describe("guardarraíl: sin organización única (organization.limit(1) sin tenant)", () => {
  it("ningún archivo fuera de server/platform/ trae 'la' organización sin filtrar", () => {
    const infractores: string[] = [];

    for (const file of archivosTs(SRC)) {
      const rel = path.relative(SRC, file);
      if (rel.split(path.sep).slice(0, 2).join(path.sep) === EXCEPCION) continue;
      const code = readFileSync(file, "utf8");
      if (!code.includes("from(schema.organization)")) continue;

      for (const bloque of bloquesDeFrom(code)) {
        if (esFallbackSinTenant(bloque)) {
          infractores.push(rel);
          break;
        }
      }
    }

    expect(
      infractores,
      `Estos archivos resuelven "la" organización sin tenant (Principio I: ` +
        `con N organizaciones, "la primera" es la de otro negocio):\n` +
        infractores.map((f) => `  · ${f}`).join("\n")
    ).toEqual([]);
  });

  it("el detector sí reconoce el patrón prohibido (si esto falla, el guardarraíl quedó ciego)", () => {
    const trampa = `
      const rows = await db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .limit(1);
    `;
    expect(bloquesDeFrom(trampa).some(esFallbackSinTenant)).toBe(true);
  });

  it("el detector NO marca un from(organization) filtrado por id", () => {
    const bien = `
      const rows = await db
        .select({ id: schema.organization.id })
        .from(schema.organization)
        .where(eq(schema.organization.id, organizationId))
        .limit(1);
    `;
    expect(bloquesDeFrom(bien).some(esFallbackSinTenant)).toBe(false);
  });
});
