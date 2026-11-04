CREATE TABLE "job_listings" (
	"source" text NOT NULL,
	"source_job_id" text NOT NULL,
	"source_url" text NOT NULL,
	"job_id" uuid NOT NULL,
	CONSTRAINT "job_listings_source_source_job_id_pk" PRIMARY KEY("source","source_job_id")
);
--> statement-breakpoint
-- Hand-written: every existing job row becomes its own listing.
INSERT INTO "job_listings" ("source", "source_job_id", "source_url", "job_id")
SELECT "source", "source_job_id", "source_url", "id" FROM "jobs";--> statement-breakpoint
-- Hand-written: jobs with the same apply link and title merge into one, keeping
-- a tagged one if any, else the earliest posted, so no job is tagged twice.
UPDATE "job_listings" SET "job_id" = "kept"."keep_id"
FROM (
	SELECT "id", first_value("id") OVER (
		PARTITION BY "apply_url", "title"
		ORDER BY "tagged_at" IS NULL, "posted_at" ASC NULLS LAST, "id"
	) AS "keep_id"
	FROM "jobs" WHERE "apply_url" IS NOT NULL
) AS "kept"
WHERE "job_listings"."job_id" = "kept"."id" AND "kept"."id" <> "kept"."keep_id";--> statement-breakpoint
DELETE FROM "jobs" WHERE NOT EXISTS (SELECT 1 FROM "job_listings" WHERE "job_listings"."job_id" = "jobs"."id");--> statement-breakpoint
DROP INDEX "jobs_source_id_idx";--> statement-breakpoint
ALTER TABLE "job_listings" ADD CONSTRAINT "job_listings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_listings_job_id_idx" ON "job_listings" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_apply_url_title_idx" ON "jobs" USING btree ("apply_url","title");--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "source";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "source_job_id";--> statement-breakpoint
ALTER TABLE "jobs" DROP COLUMN "source_url";
