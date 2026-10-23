CREATE TABLE "ai_queue" (
	"job_id" bigint PRIMARY KEY NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_sightings" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "job_sightings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" bigint NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"source_url" text NOT NULL,
	"organization_id" bigint,
	"link_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"data" jsonb NOT NULL,
	"version" text,
	"via" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"missed_checks" integer DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"gone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_tags" (
	"job_id" bigint NOT NULL,
	"origin" text NOT NULL,
	"axis" text NOT NULL,
	"tag" text NOT NULL,
	"confidence" real,
	CONSTRAINT "job_tags_job_id_origin_axis_tag_pk" PRIMARY KEY("job_id","origin","axis","tag")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "jobs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"organization_id" bigint,
	"title" text NOT NULL,
	"location" text,
	"remote_type" text,
	"salary_min" double precision,
	"salary_max" double precision,
	"salary_currency" text,
	"salary_period" text,
	"description" text,
	"apply_url" text,
	"posted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"summary" text,
	"ai_tagged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "organizations_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"domain" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_copies" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "page_copies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"job_id" bigint NOT NULL,
	"sighting_id" bigint NOT NULL,
	"url" text NOT NULL,
	"html" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_runs" ADD COLUMN "partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_queue" ADD CONSTRAINT "ai_queue_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sightings" ADD CONSTRAINT "job_sightings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sightings" ADD CONSTRAINT "job_sightings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_tags" ADD CONSTRAINT "job_tags_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_copies" ADD CONSTRAINT "page_copies_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_copies" ADD CONSTRAINT "page_copies_sighting_id_job_sightings_id_fk" FOREIGN KEY ("sighting_id") REFERENCES "public"."job_sightings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "job_sightings_source_external_id_idx" ON "job_sightings" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "job_sightings_job_id_idx" ON "job_sightings" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_sightings_link_keys_idx" ON "job_sightings" USING gin ("link_keys");--> statement-breakpoint
CREATE INDEX "job_tags_axis_tag_idx" ON "job_tags" USING btree ("axis","tag");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "jobs_organization_id_idx" ON "jobs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "jobs_closed_at_idx" ON "jobs" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "organizations_aliases_idx" ON "organizations" USING gin ("aliases");--> statement-breakpoint
CREATE INDEX "organizations_domain_idx" ON "organizations" USING btree ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "page_copies_sighting_id_idx" ON "page_copies" USING btree ("sighting_id");--> statement-breakpoint
CREATE INDEX "page_copies_job_id_idx" ON "page_copies" USING btree ("job_id");