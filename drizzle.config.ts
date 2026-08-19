import { defineConfig } from "drizzle-kit";

const url =
  process.env.DATABASE_URL?.trim() ||
  process.env.POSTGRES_URL?.trim();

if (!url) {
  console.warn(
    "[drizzle.config] DATABASE_URL is not set — drizzle-kit push will fail until it is provided.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Prefer the same connection string the app uses at runtime.
    // For Supabase: use the direct host (db.*.supabase.co:5432) for push when possible;
    // PgBouncer (pooler:6543) also works with drizzle-kit push in most cases.
    url: url ?? "postgresql://localhost:5432/postgres",
  },
  strict: true,
  verbose: true,
});
