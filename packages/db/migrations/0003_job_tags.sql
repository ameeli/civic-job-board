ALTER TABLE "jobs" ADD COLUMN "role_tags" text[];--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "sector_tags" text[];--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "seniority" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "tagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source_runs" ADD COLUMN "defaulted_to_unknown" integer DEFAULT 0 NOT NULL;