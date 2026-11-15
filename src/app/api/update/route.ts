import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

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
};

let cached: { at: number; info: Status } | null = null;

function updateScript() {
  const script = process.env.DUMP_UPDATE_SCRIPT ?? path.resolve(REPO, "..", "run", "dump-restart.cmd");
  return fs.existsSync(script) ? script : null;
}

async function git(...args: string[]) {
  const { stdout } = await run("git", args, { cwd: REPO, timeout: 8000 });
  return stdout.trim();
}

async function status(): Promise<Status> {
  const none = { supported: false, available: false, current: null, latest: null, behind: 0, canApply: !!updateScript() };
  let current: string;
  try {
    current = await git("rev-parse", "HEAD");
  } catch {
    return none;
  }
  try {
    await git("fetch", "origin", "main", "--quiet");
  } catch {
    // Offline: fall through and report the last known origin/main.
  }
  try {
    const latest = await git("rev-parse", "origin/main");
    const behind = Number(await git("rev-list", "--count", "HEAD..origin/main"));
    return {
      supported: true,
      available: behind > 0,
      current: current.slice(0, 7),
      latest: latest.slice(0, 7),
      behind,
      canApply: !!updateScript(),
    };
  } catch {
    return { ...none, supported: true, current: current.slice(0, 7) };
  }
}

export async function GET() {
  if (!cached || Date.now() - cached.at > CHECK_TTL_MS) cached = { at: Date.now(), info: await status() };
  return NextResponse.json(cached.info);
}

export async function POST() {
  const script = updateScript();
  if (!script) return NextResponse.json({ error: "No updater on this machine" }, { status: 400 });

  // The updater pulls, rebuilds, and restarts — so it must outlive this process.
  // The short delay lets this response flush before the server is killed.
  let cmd: string;
  let args: string[];
  if (process.platform === "win32") {
    const hidden = path.join(path.dirname(script), "hidden.vbs");
    const ps = fs.existsSync(hidden)
      ? `Start-Sleep -Seconds 2; Start-Process wscript -ArgumentList '"${hidden}" "${script}"'`
      : `Start-Sleep -Seconds 2; Start-Process cmd -ArgumentList '/c "${script}"'`;
    cmd = "powershell";
    args = ["-NoProfile", "-Command", ps];
  } else {
    cmd = "sh";
    args = ["-c", `sleep 2 && "${script}"`];
  }
  spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  return NextResponse.json({ started: true });
}
