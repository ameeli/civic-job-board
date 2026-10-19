import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    // Only db:migrate needs a database; db:generate diffs the schema offline.
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
});
