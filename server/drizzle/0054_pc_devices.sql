CREATE TABLE IF NOT EXISTS "devices" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"platform" text NOT NULL,
	"os_version" text,
	"hostname" text,
	"arch" text,
	"client_version" text,
	"token_hash" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"allowed_roots" jsonb NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_bot_access" (
	"device_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_bot_access_device_id_bot_id_pk" PRIMARY KEY("device_id","bot_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "device_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"device_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"action" text NOT NULL,
	"summary" text,
	"outcome" text NOT NULL,
	"detail" text,
	"duration_ms" integer
);
--> statement-breakpoint
ALTER TABLE "device_bot_access" ADD CONSTRAINT "device_bot_access_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_owner_idx" ON "devices" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devices_token_hash_idx" ON "devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_audit_device_at_idx" ON "device_audit_events" USING btree ("device_id","at");
