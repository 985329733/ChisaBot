CREATE TABLE "bot_panel_instance_versions" (
	"instance_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_panel_instance_versions_instance_id_version_pk" PRIMARY KEY("instance_id","version")
);
--> statement-breakpoint
CREATE TABLE "bot_panel_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"bot_id" text NOT NULL,
	"current_version" integer NOT NULL,
	"source_library_id" text,
	"source_version" integer,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"size" jsonb NOT NULL,
	"removed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_authoring_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"target_instance_id" text,
	"base_instance_version" integer,
	"base_library_version" integer,
	"cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_capability_grants" (
	"instance_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"grant" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panel_capability_grants_instance_id_actor_id_capability_id_pk" PRIMARY KEY("instance_id","actor_id","capability_id")
);
--> statement-breakpoint
CREATE TABLE "panel_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"target_instance_id" text,
	"draft_revision" integer NOT NULL,
	"base_instance_version" integer,
	"base_library_version" integer,
	"definition" jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_library_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"creator_actor_id" text NOT NULL,
	"current_version" integer NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel_library_versions" (
	"library_id" text NOT NULL,
	"version" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panel_library_versions_library_id_version_pk" PRIMARY KEY("library_id","version")
);
--> statement-breakpoint
CREATE TABLE "panel_operations" (
	"actor_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"bot_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panel_operations_actor_id_idempotency_key_pk" PRIMARY KEY("actor_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "panel_states" (
	"instance_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"state_revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "panel_states_instance_id_actor_id_pk" PRIMARY KEY("instance_id","actor_id")
);
--> statement-breakpoint
CREATE TABLE "panel_task_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"bot_id" text NOT NULL,
	"instance_version" integer NOT NULL,
	"capability_id" text NOT NULL,
	"capability_hash" text NOT NULL,
	"args" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_panel_instance_versions" ADD CONSTRAINT "bot_panel_instance_versions_instance_id_bot_panel_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."bot_panel_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_panel_instances" ADD CONSTRAINT "bot_panel_instances_source_library_id_panel_library_entries_id_fk" FOREIGN KEY ("source_library_id") REFERENCES "public"."panel_library_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_authoring_sessions" ADD CONSTRAINT "panel_authoring_sessions_target_instance_id_bot_panel_instances_id_fk" FOREIGN KEY ("target_instance_id") REFERENCES "public"."bot_panel_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_capability_grants" ADD CONSTRAINT "panel_capability_grants_instance_id_bot_panel_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."bot_panel_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_drafts" ADD CONSTRAINT "panel_drafts_session_id_panel_authoring_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."panel_authoring_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_drafts" ADD CONSTRAINT "panel_drafts_target_instance_id_bot_panel_instances_id_fk" FOREIGN KEY ("target_instance_id") REFERENCES "public"."bot_panel_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_library_versions" ADD CONSTRAINT "panel_library_versions_library_id_panel_library_entries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."panel_library_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_states" ADD CONSTRAINT "panel_states_instance_id_bot_panel_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."bot_panel_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_task_requests" ADD CONSTRAINT "panel_task_requests_instance_id_bot_panel_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."bot_panel_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_panel_instances_bot_position_idx" ON "bot_panel_instances" USING btree ("bot_id","position");--> statement-breakpoint
CREATE INDEX "panel_authoring_actor_bot_idx" ON "panel_authoring_sessions" USING btree ("actor_id","bot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "panel_drafts_session_idx" ON "panel_drafts" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "panel_tasks_actor_key_idx" ON "panel_task_requests" USING btree ("actor_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "panel_tasks_actor_created_idx" ON "panel_task_requests" USING btree ("actor_id","created_at");