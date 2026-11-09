import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Guard rails for the development seed tool. The tool writes a lot of fake data, so it refuses to
 * run unless every check passes. It can never be pointed at a project you have not explicitly
 * allowed by id.
 */

export class SeedSafetyError extends Error {}

export type SeedEnv = Record<string, string | undefined>;

export type SeedTarget = { url: string; ref: string; publishableKey: string };

export function assertDevOnly(env: SeedEnv): SeedTarget {
  if (env.NODE_ENV === "production") {
    throw new SeedSafetyError("Refusing to run with NODE_ENV=production.");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new SeedSafetyError(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set (see .env.local).",
    );
  }
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/.exec(url);
  if (!match) {
    throw new SeedSafetyError("NEXT_PUBLIC_SUPABASE_URL must look like https://<project-ref>.supabase.co.");
  }
  const allowed = env.SEED_ALLOWED_PROJECT_REF;
  if (!allowed) {
    throw new SeedSafetyError(
      "Set SEED_ALLOWED_PROJECT_REF in .env.local to the id of the DEVELOPMENT Supabase project.",
    );
  }
  if (env.NEXT_PUBLIC_APP_ENV === "production") {
    throw new SeedSafetyError("NEXT_PUBLIC_APP_ENV is production. Refusing to run.");
  }
  const protectedRefs = (env.SEED_PROTECTED_PROJECT_REFS ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  if (protectedRefs.includes(match[1])) {
    throw new SeedSafetyError("This project is on the protected list (SEED_PROTECTED_PROJECT_REFS). Refusing to run.");
  }
  if (match[1] !== allowed) {
    throw new SeedSafetyError(
      "The configured Supabase project is not the one in SEED_ALLOWED_PROJECT_REF. Refusing to seed it.",
    );
  }
  return { url: url.replace(/\/$/, ""), ref: match[1], publishableKey };
}

/** Loads .env.local (if present) into the environment, then returns it. */
export function loadEnvironment(cwd: string = process.cwd()): SeedEnv {
  const file = path.join(cwd, ".env.local");
  if (existsSync(file)) process.loadEnvFile(file);
  return process.env;
}

/** The privileged token is only needed for backdated content and cleanup. Never printed. */
export function requireManagementToken(env: SeedEnv): string {
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    throw new SeedSafetyError(
      "SUPABASE_ACCESS_TOKEN is not set. Create a token limited to the development project in " +
        "Supabase > Account > Access Tokens and export it for this command only (never commit it).",
    );
  }
  return token;
}
