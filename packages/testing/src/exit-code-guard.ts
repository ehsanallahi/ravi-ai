/**
 * embedded-postgres depends on async-exit-hook, which listens for `beforeExit` and then calls
 * `process.exit(0)`. Vitest reports failures by setting `process.exitCode = 1` and letting the
 * process end, so without this guard a failing integration run exits 0 and CI stays green.
 *
 * The guard records the exit code before any other `beforeExit` listener runs and restores it in
 * the `exit` event (Node reads `process.exitCode` again after the `exit` listeners). It never
 * turns a failure into success and does nothing when no exit code was set.
 */
let installed = false;

export function installExitCodeGuard(): void {
  if (installed) return;
  installed = true;
  let intended: number | undefined;
  const remember = () => {
    const code = Number(process.exitCode ?? 0);
    if (code !== 0) intended = code;
  };
  process.prependListener("beforeExit", remember);
  process.on("exit", () => {
    remember();
    if (intended !== undefined) process.exitCode = intended;
  });
}
