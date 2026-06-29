// Cross-platform preinstall guard (replaces a bash `sh -c` script that failed on
// Windows where `sh` is not on PATH). Enforces pnpm and clears stray lockfiles.
import { rmSync } from "node:fs";

for (const f of ["package-lock.json", "yarn.lock"]) {
  try {
    rmSync(f, { force: true });
  } catch {
    // ignore — file may not exist
  }
}

const ua = process.env.npm_config_user_agent || "";
if (!ua.startsWith("pnpm/")) {
  console.error("This workspace uses pnpm. Run `pnpm install` instead.");
  process.exit(1);
}
