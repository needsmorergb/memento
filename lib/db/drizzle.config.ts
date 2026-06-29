import { defineConfig } from "drizzle-kit";
import path from "path";
import { existsSync } from "fs";

// Load the repo-root .env for local development (Replit injects env directly,
// so this is a no-op there). Skip if DATABASE_URL is already set.
const rootEnv = path.join(__dirname, "../../.env");
if (!process.env.DATABASE_URL && existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  // Forward slashes: drizzle-kit globs this path, and Windows backslashes break globbing.
  schema: path.join(__dirname, "./src/schema/index.ts").replace(/\\/g, "/"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
