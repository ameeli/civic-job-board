import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import journal from "../migrations/meta/_journal.json";

const migrationSql = (tag: string) => readFileSync(new URL(`../migrations/${tag}.sql`, import.meta.url), "utf8");

it("merges existing jobs with the same apply link and title, keeping the tagged one", async () => {
  const pg = new PGlite();
  const [mergeMigration, ...earlier] = journal.entries.map(entry => entry.tag).reverse();
  for (const tag of earlier.reverse()) await pg.exec(migrationSql(tag));
  await pg.exec(`
    INSERT INTO jobs (id, source, source_job_id, source_url, title, description, apply_url, posted_at, tagged_at) VALUES
      ('00000000-0000-0000-0000-000000000001', 'gov', '1', 'https://gov/1', 'Engineer', '', 'https://apply/1', '2026-10-01', NULL),
      ('00000000-0000-0000-0000-000000000002', 'gov', '2', 'https://gov/2', 'Engineer', '', 'https://apply/1', '2026-10-02', now()),
      ('00000000-0000-0000-0000-000000000003', 'guide', 'a', 'https://guide/a', 'Engineer', '', 'https://apply/1', '2026-10-03', NULL),
      ('00000000-0000-0000-0000-000000000004', 'guide', 'b', 'https://guide/b', 'Analyst', '', 'https://apply/1', NULL, NULL),
      ('00000000-0000-0000-0000-000000000005', 'guide', 'c', 'https://guide/c', 'Engineer', '', NULL, NULL, NULL),
      ('00000000-0000-0000-0000-000000000006', 'guide', 'd', 'https://guide/d', 'Engineer', '', NULL, NULL, NULL);
  `);
  await pg.exec(migrationSql(mergeMigration!));

  const { rows: jobs } = await pg.query<{ id: string }>("SELECT id FROM jobs ORDER BY id");
  expect(jobs.map(job => job.id.at(-1))).toEqual(["2", "4", "5", "6"]);
  const { rows: listings } = await pg.query<{ listing: string; job: string }>(
    "SELECT source || ':' || source_job_id AS listing, right(job_id::text, 1) AS job FROM job_listings ORDER BY 1",
  );
  expect(listings).toEqual([
    { listing: "gov:1", job: "2" }, { listing: "gov:2", job: "2" }, { listing: "guide:a", job: "2" },
    { listing: "guide:b", job: "4" }, { listing: "guide:c", job: "5" }, { listing: "guide:d", job: "6" },
  ]);
});
