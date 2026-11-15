import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const run = promisify(execFile);
const REPO = process.cwd();
const CHECK_TTL_MS = 60_000;

type Status = {
  supported: boolean;
  available: boolean;
  current: string | null;
  latest: string | null;
  behind: number;
  canApply: boolean;
  // null = no prepare info; preparing = staging a build now; prepared = staged
  // build ready to swap in; failed = staging failed (apply still works inline);
  // applied = a staged build was swapped in on the last restart.
  phase: "preparing" | "prepared" | "failed" | "applied" | null;
};

let cached: { at: number; info: Status } | null = null;
const preparedFor = new Set<string>();

const DATA_DIR = path.resolve(process.env.DUMP_DATA_DIR ?? path.join(REPO, "data"));
const STATE_FILE = path.join(DATA_DIR, "update-state.json");

function updateScript() {
  const script = process.env.DUMP_UPDATE_SCRIPT ?? path.resolve(REPO, "..", "run", "dump-restart.cmd");
  return fs.existsSync(script) ? script : null;
}

function updatePhase(): Status["phase"] {
  try {
    const phase = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")).phase;
    if (phase === "preparing" || phase === "prepared" || phase === "failed" || phase === "applied") return phase;
  } catch {}
  return null;
}

// Build the new commit in a staging worktree in the background, so clicking
// Update only has to swap it in and restart — seconds, like a binary update.
function prepare(latest: string) {
  if (preparedFor.has(latest)) return;
  const script = path.join(REPO, "scripts", "update.mjs");
  if (!fs.existsSync(script)) return;
  preparedFor.add(latest);
  const child = spawn(process.execPath, [script, "prepare"], { detached: true, stdio: "ignore" });
  child.unref();
}

async function git(...args: string[]) {
  const { stdout } = await run("git", args, { cwd: REPO, timeout: 8000 });
  return stdout.trim();
}

// The commit this process is actually serving: stamped into .next by the postbuild
// script, so a pull that lands before the rebuild doesn't masquerade as the new build.
function runningSha() {
  try {
    const sha = fs.readFileSync(path.join(REPO, ".next", "build-sha"), "utf8").trim();
    if (/^[0-9a-f]{40}$/i.test(sha)) return sha;
  } catch {}
  return null;
}

async function status(): Promise<Status> {
  const none = { supported: false, available: false, current: null, latest: null, behind: 0, canApply: !!updateScript(), phase: updatePhase() };
  let head: string;
  try {
    head = await git("rev-parse", "HEAD");
  } catch {
    return none;
  }
  const current = runningSha() ?? head; // dev servers have no stamp; the checkout is the build
  try {
    await git("fetch", "origin", "main", "--quiet");
  } catch {
    // Offline: fall through and report the last known origin/main.
  }
  try {
    const latest = await git("rev-parse", "origin/main");
    const behind = Number(await git("rev-list", "--count", `${current}..origin/main`));
    if (behind > 0 && updateScript()) prepare(latest);
    return {
      supported: true,
      available: behind > 0,
      current: current.slice(0, 7),
      latest: latest.slice(0, 7),
      behind,
      canApply: !!updateScript(),
      phase: updatePhase(),
    };
  } catch {
    return { ...none, supported: true, current: current.slice(0, 7) };
  }
}

export async function GET(req: NextRequest) {
  // ?fresh skips the cache: the post-apply poll needs live status, not a value
  // re-cached mid-flight while the updater is still swapping builds.
  if (!req.nextUrl.searchParams.has("fresh") && cached && Date.now() - cached.at <= CHECK_TTL_MS) {
    return NextResponse.json(cached.info);
  }
  cached = { at: Date.now(), info: await status() };
  return NextResponse.json(cached.info);
}

export async function POST(req: NextRequest) {
  // Applying an update restarts this machine, so only same-site pages may trigger it:
  // a cross-site form post or no-cors fetch must not be able to bounce the server.
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return NextResponse.json({ error: "Cross-site request" }, { status: 403 });
  const origin = req.headers.get("origin");
  try {
    if (origin && new URL(origin).host !== req.headers.get("host")) {
      return NextResponse.json({ error: "Cross-site request" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Cross-site request" }, { status: 403 });
  }

  const script = updateScript();
  if (!script) return NextResponse.json({ error: "No updater on this machine" }, { status: 400 });

  // The updater pulls, rebuilds, and restarts — so it must outlive this process.
  // The short delay lets this response flush before the server is killed.
  const psQuote = (s: string) => `'${s.replaceAll("'", "''")}'`;
  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {
    const hidden = path.join(path.dirname(script), "hidden.vbs");
    const ps = fs.existsSync(hidden)
      ? `Start-Sleep -Seconds 2; Start-Process wscript -ArgumentList ${psQuote(`"${hidden}" "${script}"`)}`
      : `Start-Sleep -Seconds 2; Start-Process cmd -ArgumentList ${psQuote(`/c "${script}"`)}`;
    cmd = "powershell";
    args = ["-NoProfile", "-Command", ps];
  } else {
    cmd = "sh";
    args = ["-c", `sleep 2 && "${script}"`];
  }
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  return NextResponse.json({ started: true });
}
