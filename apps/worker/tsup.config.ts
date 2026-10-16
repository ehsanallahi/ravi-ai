import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them; keep Prisma's native client external.
  noExternal: [/^@ravi\//],
  external: ["@prisma/client", ".prisma/client"],
});
