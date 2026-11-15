// Dump's updater. Two commands, run by the run/*.cmd wrappers on the laptop:
//
//   node scripts/update.mjs prepare   Build origin/main in a staging worktree
//                                     while the server keeps running. The app
//                                     kicks this off in the background as soon
//                                     as it sees a newer commit, so the slow
//                                     part is done before anyone clicks Update.
//
//   node scripts/update.mjs apply     Pull main, swap in the staged build, and
//                                     hand back to `next start`. Runs while the
//                                     server is stopped; with a staged build
//                                     this is seconds, not minutes.
//
// Falls back to an in-place `npm run build` (with the old rollback-on-failure
// behaviour) whenever no staged build exists for the target commit, so the
// Start-menu shortcut and first-ever update still work on old checkouts.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.resolve(process.env.DUMP_DATA_DIR ?? path.join(REPO, "data"));
const STATE = path.join(DATA_DIR, "update-state.json");
const LOCK = path.join(DATA_DIR, "update-prepare.lock");
const BUILDS = path.join(DATA_DIR, "builds");
const LOCK_TTL_MS = 30 * 60 * 1000; // a crashed prepare stops blocking after this
const WAIT_STAGED_MS = 3 * 60 * 1000; // apply waits this long for an in-flight prepare

const isWin = process.platform === "win32";
const npm = isWin ? "npm.cmd" : "npm";

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts }).trim();
}
const git = (...args) => sh("git", args);
const npmIn = (cwd, args) => execFileSync(npm, args, { cwd, stdio: "inherit", shell: isWin });

const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return null;
  }
};
const writeState = (patch) => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE, JSON.stringify({ ...readState(), ...patch, at: Date.now() }));
};
const builtAt = (dir) => fs.existsSync(path.join(dir, ".next", "BUILD_ID"));
const lockChanged = (from, to) => git("diff", "--name-only", from, to, "--", "package-lock.json") !== "";

function log(msg) {
  console.log(`[update] ${msg}`);
}

function prepare() {
  try {
    git("fetch", "origin", "main", "--quiet");
  } catch {
    return; // offline — next check tries again
  }
  const sha = git("rev-parse", "origin/main");

  const st = readState();
  if (st?.phase === "prepared" && st.sha === sha && st.dir && builtAt(st.dir)) return;

  // One prepare at a time; a leftover lock from a crash expires on its own.
  try {
    const lockAge = Date.now() - fs.statSync(LOCK).mtimeMs;
    if (lockAge < LOCK_TTL_MS) return;
  } catch {}
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    writeState({ phase: "preparing", sha });

    const dir = path.join(BUILDS, sha);
    // Stale builds from earlier commits only waste disk.
    try {
      for (const entry of fs.readdirSync(BUILDS)) {
        if (entry !== sha) {
          fs.rmSync(path.join(BUILDS, entry), { recursive: true, force: true });
          git("worktree", "prune");
        }
      }
    } catch {}
    fs.mkdirSync(BUILDS, { recursive: true });

    if (!fs.existsSync(path.join(dir, ".git"))) {
      fs.rmSync(dir, { recursive: true, force: true });
      git("worktree", "add", "--detach", dir, sha);
    }

    const stagedNm = path.join(dir, "node_modules");
    if (!fs.existsSync(stagedNm)) {
      // Identical lockfile => identical tree, so link the live modules instead
      // of downloading them again (instant, and the build only reads them).
      const repoNm = path.join(REPO, "node_modules");
      if (!lockChanged("HEAD", sha) && fs.existsSync(repoNm)) {
        fs.symlinkSync(repoNm, stagedNm, isWin ? "junction" : "dir");
      } else {
        npmIn(dir, ["ci"]);
      }
    }

    npmIn(dir, ["run", "build"]);
    if (!builtAt(dir)) throw new Error("build produced no .next");
    writeState({ phase: "prepared", sha, dir });
    log(`staged ${sha.slice(0, 7)} — the next restart will swap it in`);
  } catch (e) {
    writeState({ phase: "failed", sha, error: String(e?.message ?? e) });
    process.exitCode = 1;
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

function apply() {
  let old;
  try {
    old = git("rev-parse", "HEAD");
  } catch {
    log("not a git checkout — nothing to update");
    return;
  }
  try {
    git("pull", "--ff-only");
  } catch {
    log("git pull failed (offline or local changes); keeping current version");
  }
  const head = git("rev-parse", "HEAD");

  if (old === head && builtAt(REPO)) {
    log(`already up to date at ${head}`);
    return;
  }

  // Wait briefly if a background prepare for this exact commit is mid-flight.
  let st = readState();
  const deadline = Date.now() + WAIT_STAGED_MS;
  const nap = new Int32Array(new SharedArrayBuffer(4));
  while (st?.phase === "preparing" && st.sha === head && Date.now() < deadline) {
    Atomics.wait(nap, 0, 0, 1000);
    st = readState();
  }

  // Swap in the staged build even if origin/main moved past it — a slightly
  // stale fast update beats a slow inline build; the button stays available
  // for whatever is still behind.
  const isAncestor = (a, b) => {
    try {
      git("merge-base", "--is-ancestor", a, b);
      return true;
    } catch {
      return false;
    }
  };
  const staged =
    st?.phase === "prepared" && st.dir && builtAt(st.dir) && isAncestor(st.sha, head) ? st : null;

  if (staged) {
    try {
      // Only when the lockfile moved do we pay for a real install in the app;
      // sharing the staged node_modules isn't safe across lockfile changes.
      if (lockChanged(old, staged.sha)) npmIn(REPO, ["ci"]);
      fs.rmSync(path.join(REPO, ".next"), { recursive: true, force: true });
      fs.cpSync(path.join(staged.dir, ".next"), path.join(REPO, ".next"), { recursive: true });
      try {
        git("worktree", "remove", "--force", staged.dir);
      } catch {}
      writeState({ phase: "applied", sha: staged.sha });
      log(`swapped in staged build ${staged.sha.slice(0, 7)}`);
      return;
    } catch (e) {
      log(`staged swap failed (${e?.message ?? e}); building in place instead`);
    }
  }

  // No staged build: the original behaviour — install if needed, build, and on
  // failure roll back to the previous commit and rebuild that.
  if (lockChanged(old, head) || !fs.existsSync(path.join(REPO, "node_modules"))) npmIn(REPO, ["ci"]);
  try {
    npmIn(REPO, ["run", "build"]);
    log(`built ${head}`);
  } catch {
    log(`build of ${head} failed; rolling back to ${old}`);
    git("reset", "--keep", old);
    npmIn(REPO, ["ci"]);
    npmIn(REPO, ["run", "build"]);
  }
}

const cmd = process.argv[2];
if (cmd === "prepare") prepare();
else if (cmd === "apply") apply();
else {
  console.error("usage: node scripts/update.mjs prepare|apply");
  process.exit(2);
}
