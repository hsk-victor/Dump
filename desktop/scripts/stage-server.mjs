// Builds Dump as a Next.js standalone server and stages it, with the Node runtime
// that built it, into src-tauri/server for the Tauri bundler to ship as a resource.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(desktop, "..");
const out = path.join(desktop, "src-tauri", "server");
const standalone = path.join(root, ".next", "standalone");

if (process.platform !== "win32" || process.arch !== "x64") {
  // The native modules (better-sqlite3, sharp) and node.exe are taken from this machine.
  throw new Error("Stage the desktop server on Windows x64: it ships this machine's node.exe and native modules.");
}

execSync("npm run build", { cwd: root, stdio: "inherit", env: { ...process.env, DUMP_STANDALONE: "1" } });

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(standalone, out, { recursive: true, dereference: true });
fs.cpSync(path.join(root, ".next", "static"), path.join(out, ".next", "static"), { recursive: true });
fs.cpSync(path.join(root, "public"), path.join(out, "public"), { recursive: true });
fs.copyFileSync(path.join(desktop, "server-entry.cjs"), path.join(out, "server-entry.cjs"));
fs.copyFileSync(process.execPath, path.join(out, "node.exe"));

// Never ship the build machine's library or env files.
for (const name of ["data", ".env", ".env.local", ".env.production", ".env.production.local"]) {
  fs.rmSync(path.join(out, name), { recursive: true, force: true });
}

// Tracing keeps every platform's better-sqlite3 prebuild; only Windows x64 is loadable here.
const prebuilds = path.join(out, "node_modules", "better-sqlite3", "prebuilds");
if (fs.existsSync(prebuilds)) {
  for (const f of fs.readdirSync(prebuilds)) {
    if (f !== "win32-x64.node") fs.rmSync(path.join(prebuilds, f), { recursive: true, force: true });
  }
}

let files = 0;
let bytes = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files++;
      bytes += fs.statSync(p).size;
    }
  }
})(out);
console.log(`Staged ${files} files, ${(bytes / 1048576).toFixed(1)} MB, Node ${process.version}, in ${path.relative(root, out)}`);
