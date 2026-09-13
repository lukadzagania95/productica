import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const python =
  process.platform === "win32"
    ? "worker/.venv/Scripts/python.exe"
    : "worker/.venv/bin/python";
const child = spawn(python, ["scripts/run-worker.py"], { stdio: "inherit" });
child.on("error", () => {
  console.error("Run npm run setup:local before starting the worker.");
  process.exit(1);
});
child.on("exit", (code) => process.exit(code || 0));
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
