import { parsePlatformAdminEmails } from "@/lib/env";

/**
 * 020 — Registro público SIEMPRE abierto (D2): cada alta crea su propia
 * organización. La única razón para rechazar un alta pública es que el
 * correo esté reservado para el super-admin (E4/FR-004) — así nadie puede
 * adelantarse a registrar el correo que el operador va a verificar con
 * `scripts/platform-admin.mjs`.
 */
export function isReservedPlatformEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return parsePlatformAdminEmails().includes(normalized);
}
