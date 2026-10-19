import path from "node:path";
import { defineConfig } from "vitest/config";

const testing = path.resolve(import.meta.dirname, "../../packages/testing/src");

/** Integration tests run against a throwaway PostgreSQL database (see @ravi/testing). */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    globalSetup: [path.join(testing, "global-setup.ts")],
    setupFiles: [path.join(testing, "setup-env.ts")],
    // One shared database: run files sequentially so truncation can't race.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
