import { expect, it } from "vitest";
import vercel from "../vercel.json";
import { JOB_SOURCES } from "./lib/daily-check";

const fetchCrons = vercel.crons.filter(cron => cron.path.startsWith("/api/cron/fetch-jobs"));
const tagCrons = vercel.crons.filter(cron => cron.path === "/api/cron/tag-jobs");
/** The UTC hour of a daily "<minute> <hour> * * *" schedule. */
const hourOf = (schedule: string) => {
  const [minute, hour, ...everyDay] = schedule.split(" ");
  expect([minute, everyDay]).toEqual(["0", ["*", "*", "*"]]);
  return Number(hour);
};

it("schedules one fetch cron per job source", () => {
  expect(fetchCrons.map(cron => cron.path).sort())
    .toEqual(JOB_SOURCES.map(source => `/api/cron/fetch-jobs/${source}`).sort());
});

it("fetches from midnight to 2am Pacific standard time, before the first tagging run", () => {
  // UTC 08:00-09:59 is 00:00-01:59 PST (01:00-02:59 during daylight saving time).
  for (const cron of fetchCrons) expect([8, 9]).toContain(hourOf(cron.schedule));
  expect(tagCrons.map(cron => hourOf(cron.schedule))).toEqual([11, 14]);
});
