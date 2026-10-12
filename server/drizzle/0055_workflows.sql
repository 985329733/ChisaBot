CREATE TABLE "workflow_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"step_id" text,
	"message" text NOT NULL,
	"data" jsonb
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"workflow_id" text NOT NULL,
	"workflow_name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"bindings" jsonb NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"state" jsonb NOT NULL,
	"output" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"definition" jsonb NOT NULL,
	"origin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workflow_run_events" ADD CONSTRAINT "workflow_run_events_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_run_events_run_idx" ON "workflow_run_events" USING btree ("run_id","at");--> statement-breakpoint
CREATE INDEX "workflow_runs_owner_created_idx" ON "workflow_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "workflows_owner_idx" ON "workflows" USING btree ("owner_user_id");