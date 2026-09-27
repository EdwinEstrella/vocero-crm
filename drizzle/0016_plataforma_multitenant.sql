-- 020 - Plataforma multi-tenant: registro abierto (cada alta crea su propia
-- organizacion), super-admin de plataforma (suspender/reactivar/borrar/
-- suplantar, con auditoria) y clave de API por organizacion para
-- /api/bot/* (retira el BOT_API_KEY global).
--
-- Editada a mano sobre la generada para ser RE-EJECUTABLE (Constitucion IV):
-- IF NOT EXISTS en tablas, columnas e indices, y bloque DO en cada clave
-- foranea.
--
-- Puramente ADITIVA: dos columnas nuevas (organization.suspended_at/
-- suspended_reason, whatsapp_coexistence_claim.activated_at) y cuatro tablas
-- nuevas. Las filas que ya existen quedan activas (suspended_at NULL) y sin
-- clave de API hasta que el owner genere una en Ajustes.
--
-- platform_audit_event y platform_impersonation NO llevan FK cascade en
-- organization_id (Complexity Tracking del plan 020): deben sobrevivir al
-- borrado de la organizacion que auditan/suplantaron.

CREATE TABLE IF NOT EXISTS "bot_api_key" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"key_hash" text NOT NULL,
	"last4" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"organization_id" text NOT NULL,
	"organization_name" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "platform_impersonation" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"ended_at" timestamp,
	"ended_reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_smb_sync_request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"phone_number_id" text NOT NULL,
	"sync_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_id" text,
	"error" text,
	"items_received" integer DEFAULT 0 NOT NULL,
	"progress" integer,
	"window_expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN IF NOT EXISTS "suspended_reason" text;--> statement-breakpoint
ALTER TABLE "whatsapp_coexistence_claim" ADD COLUMN IF NOT EXISTS "activated_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "bot_api_key" ADD CONSTRAINT "bot_api_key_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "platform_impersonation" ADD CONSTRAINT "platform_impersonation_admin_user_id_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "whatsapp_smb_sync_request" ADD CONSTRAINT "whatsapp_smb_sync_request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bot_api_key_hash_uq" ON "bot_api_key" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bot_api_key_org_active_uq" ON "bot_api_key" USING btree ("organization_id") WHERE "bot_api_key"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pae_org_created_idx" ON "platform_audit_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pae_created_idx" ON "platform_audit_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "imp_admin_active_uq" ON "platform_impersonation" USING btree ("admin_user_id") WHERE "platform_impersonation"."ended_at" is null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "imp_org_idx" ON "platform_impersonation" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "smb_sync_org_phone_type_uq" ON "whatsapp_smb_sync_request" USING btree ("organization_id","phone_number_id","sync_type");
