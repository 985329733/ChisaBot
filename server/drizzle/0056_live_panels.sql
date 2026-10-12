CREATE TABLE "live_panels" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text NOT NULL,
	"spec" text,
	"sources" jsonb NOT NULL,
	"instruction" text NOT NULL,
	"refresh_minutes" integer,
	"error" text,
	"previous" jsonb,
	"refreshed_at" timestamp with time zone,
	"next_refresh_at" timestamp with time zone,
	"lease_until" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "live_panels_owner_bot_idx" ON "live_panels" USING btree ("owner_user_id","bot_id");--> statement-breakpoint
CREATE INDEX "live_panels_next_refresh_idx" ON "live_panels" USING btree ("next_refresh_at");