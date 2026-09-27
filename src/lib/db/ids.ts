import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const nano = customAlphabet(alphabet, 20);

const prefixes = {
  organization: "org",
  member: "mem",
  contact: "ct",
  conversation: "cv",
  message: "msg",
  lead: "ld",
  stage: "stg",
  leadStageEvent: "lse",
  credentials: "cred",
  agentProfile: "agp",
  kbEntry: "kb",
  template: "tpl",
  testRun: "run",
  testCase: "case",
  mediaAsset: "ma",
  // 015 — motor de agenda
  calendarSettings: "cal",
  booking: "bk",
  offeredSlot: "ofs",
  zoomCredentials: "zcred",
  googleCredentials: "gcred",
  // 016 — atribución de anuncios
  adAttribution: "att",
  conversionEvent: "cve",
  capiSettings: "capi",
  coexistenceAttempt: "wca",
  coexistenceClaim: "wcc",
  coexistenceDelivery: "wcd",
  // 020 — plataforma multi-tenant
  platformAuditEvent: "pae",
  impersonation: "imp",
  botApiKey: "bak",
  smbSyncRequest: "wss",
} as const;

export type IdKind = keyof typeof prefixes;

export function newId(kind: IdKind): string {
  return `${prefixes[kind]}_${nano()}`;
}
