import path from "node:path";
import { defineConfig } from "vitest/config";

const testing = path.resolve(import.meta.dirname, "../../packages/testing/src");

/** Integration tests run against a throwaway PostgreSQL database (see @ravi/testing). */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.int.test.ts"],
    globalSetup: [path.join(testing, "global-setup.ts")],
    setupFiles: [path.join(testing, "setup-env.ts")],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
