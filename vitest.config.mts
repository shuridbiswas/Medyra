import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Many suites boot an in-memory Postgres with every migration; give them room when run together.
    maxWorkers: 4,
    hookTimeout: 90_000,
    testTimeout: 30_000,
    include: ["src/**/*.test.{ts,tsx}", "supabase/tests/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
