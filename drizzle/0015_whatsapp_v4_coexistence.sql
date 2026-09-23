-- WhatsApp Embedded Signup v4 coexistence. Additive and safely re-runnable.
ALTER TABLE "message" ADD COLUMN IF NOT EXISTS "import_source" text NOT NULL DEFAULT 'live';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_coexistence_attempt" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "owner_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "state_hash" text NOT NULL,
  "nonce_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "reason" text,
  "phone_number_id" text,
  "consented_at" timestamp,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_coexistence_attempt_state_uq" ON "whatsapp_coexistence_attempt" ("state_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_coexistence_attempt_org_idx" ON "whatsapp_coexistence_attempt" ("organization_id", "created_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_coexistence_claim" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "attempt_id" text NOT NULL REFERENCES "whatsapp_coexistence_attempt"("id") ON DELETE cascade,
  "phone_number_id" text NOT NULL,
  "waba_id" text NOT NULL,
  "token_cipher" text NOT NULL,
  "token_iv" text NOT NULL,
  "token_tag" text NOT NULL,
  "status" text NOT NULL DEFAULT 'awaiting_confirmation',
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_coexistence_claim_phone_uq" ON "whatsapp_coexistence_claim" ("phone_number_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_coexistence_claim_attempt_uq" ON "whatsapp_coexistence_claim" ("attempt_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_coexistence_claim_org_idx" ON "whatsapp_coexistence_claim" ("organization_id", "status");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_coexistence_delivery" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organization"("id") ON DELETE cascade,
  "event_key" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp NOT NULL DEFAULT now(),
  "lease_until" timestamp,
  "last_error" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wa_coexistence_delivery_org_event_uq" ON "whatsapp_coexistence_delivery" ("organization_id", "event_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wa_coexistence_delivery_ready_idx" ON "whatsapp_coexistence_delivery" ("status", "next_attempt_at");
