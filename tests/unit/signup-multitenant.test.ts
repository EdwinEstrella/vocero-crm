import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * 020 (US1) — Cada alta pública crea SU PROPIA organización; una interna
 * (equipo, script del operador) no crea ninguna. Sin lock de "primer
 * arranque": dos registros simultáneos simplemente producen dos
 * organizaciones distintas (FR-002/003).
 */

type Insert = { table: unknown; values: Record<string, unknown> };

function fakeDb() {
  const inserts: Insert[] = [];
  const tx = {
    insert: (table: unknown) => ({
      values: (v: unknown) => {
        inserts.push({ table, values: v as Record<string, unknown> });
        return Promise.resolve();
      },
    }),
  };
  return {
    transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      await fn(tx);
    },
    inserts,
  };
}

describe("onUserCreated (alta pública vs. interna)", () => {
  it("dos altas públicas seguidas → dos organizaciones distintas, cada una con su owner", async () => {
    vi.resetModules();
    const real = await import("@/lib/db/schema");
    const db = fakeDb();
    vi.doMock("@/lib/db", () => ({ getDb: () => db, schema: real }));

    const { onUserCreated } = await import("@/server/auth/on-signup");
    await onUserCreated("user_a", "Ana", { internal: false });
    await onUserCreated("user_b", "Beto", { internal: false });

    const orgInserts = db.inserts.filter((i) => i.table === real.organization);
    const memberInserts = db.inserts.filter((i) => i.table === real.member);
    expect(orgInserts).toHaveLength(2);
    expect(memberInserts).toHaveLength(2);

    const orgIds = orgInserts.map((i) => i.values.id);
    expect(new Set(orgIds).size).toBe(2); // distintas organizaciones

    // Cada membresía es `owner` de SU organización, no de la del otro.
    expect(memberInserts[0]!.values.role).toBe("owner");
    expect(memberInserts[1]!.values.role).toBe("owner");
    expect(memberInserts[0]!.values.organizationId).toBe(orgIds[0]);
    expect(memberInserts[1]!.values.organizationId).toBe(orgIds[1]);
    expect(memberInserts[0]!.values.userId).toBe("user_a");
    expect(memberInserts[1]!.values.userId).toBe("user_b");

    // Etapas sembradas + perfil del agente para CADA organización.
    const stageInserts = db.inserts.filter((i) => i.table === real.pipelineStage);
    const profileInserts = db.inserts.filter((i) => i.table === real.agentProfile);
    expect(stageInserts).toHaveLength(2); // dos llamadas .values([...]) (array)
    expect(profileInserts).toHaveLength(2);

    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });

  it("alta interna (equipo / script del operador) NO crea organización", async () => {
    vi.resetModules();
    const real = await import("@/lib/db/schema");
    const db = fakeDb();
    vi.doMock("@/lib/db", () => ({ getDb: () => db, schema: real }));

    const { onUserCreated } = await import("@/server/auth/on-signup");
    await onUserCreated("user_team", "Miembro de equipo", { internal: true });

    expect(db.inserts).toHaveLength(0);

    vi.doUnmock("@/lib/db");
    vi.resetModules();
  });
});

describe("guardarraíl: onUserCreated jamás marca emailVerified", () => {
  it("el archivo no toca ese campo — solo Better Auth (requireEmailVerification: false) decide", () => {
    const file = path.resolve(
      import.meta.dirname,
      "..",
      "..",
      "src",
      "server",
      "auth",
      "on-signup.ts"
    );
    const code = readFileSync(file, "utf8");
    expect(code).not.toMatch(/emailVerified/);
  });
});
