import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
const python = process.env.PRODUCTICA_PYTHON || "python3";
if (!existsSync(".env")) {
  writeFileSync(
    ".env",
    `TRAINING_WORKER_URL=http://127.0.0.1:8001\nTRAINING_WORKER_KEY=${randomBytes(32).toString("hex")}\n`,
    { mode: 0o600 },
  );
}
if (!existsSync(".dev.vars"))
  writeFileSync(".dev.vars", readFileSync(".env"), { mode: 0o600 });
if (!existsSync("worker/.venv")) run(python, ["-m", "venv", "worker/.venv"]);
const venvPython =
  process.platform === "win32"
    ? "worker/.venv/Scripts/python.exe"
    : "worker/.venv/bin/python";
run(venvPython, ["-m", "pip", "install", "-r", "worker/requirements.txt"]);
run(process.execPath, [
  "--import",
  "./scripts/sites-env.mjs",
  "./node_modules/wrangler/bin/wrangler.js",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--config",
  "wrangler.local.json",
]);
console.log(
  "\nSetup complete. Run npm run worker and npm run dev in separate terminals.",
);
