CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_job_id" text NOT NULL,
	"title" text NOT NULL,
	"employer_name" text,
	"location" text,
	"salary" text,
	"description" text NOT NULL,
	"apply_url" text,
	"source_url" text NOT NULL,
	"posted_at" timestamp with time zone,
	"deadline" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_id_idx" ON "jobs" USING btree ("source","source_job_id");