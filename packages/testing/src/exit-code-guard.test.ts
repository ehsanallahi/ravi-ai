import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const guard = pathToFileURL(path.join(import.meta.dirname, "exit-code-guard.ts")).href;

/** Runs a child Node process with the guard installed and returns its exit status. */
function run(body: string): number | null {
  const code = `import { installExitCodeGuard } from ${JSON.stringify(guard)};
installExitCodeGuard();
${body}`;
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
    cwd: import.meta.dirname,
  }).status;
}

// Same behaviour as async-exit-hook (pulled in by embedded-postgres): exit 0 on beforeExit.
const exitHook = `process.on("beforeExit", () => process.exit(0));`;

describe("installExitCodeGuard", () => {
  it("keeps a failing exit code when an exit hook calls process.exit(0)", () => {
    expect(run(`${exitHook}\nprocess.exitCode = 1;`)).toBe(1);
  });

  it("leaves successful and explicit exits unchanged", () => {
    expect(run(exitHook)).toBe(0);
    expect(run(`${exitHook}\nprocess.exit(3);`)).toBe(3);
  });
});
