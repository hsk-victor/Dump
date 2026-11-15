// Stamps the built commit into .next so /api/update can report what is actually
// serving rather than what happens to be checked out. Never fails the build.
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

try {
  writeFileSync(".next/build-sha", execSync("git rev-parse HEAD", { encoding: "utf8" }).trim() + "\n");
} catch {}
