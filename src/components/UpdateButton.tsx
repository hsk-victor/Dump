"use client";

import { useCallback, useEffect, useState } from "react";

type UpdateInfo = {
  supported: boolean;
  available: boolean;
  current: string | null;
  latest: string | null;
  behind: number;
  canApply: boolean;
};

const CHECK_MS = 10 * 60 * 1000;
const APPLY_TIMEOUT_MS = 5 * 60 * 1000;

export default function UpdateButton() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<"idle" | "updating" | "failed">("idle");

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/update", { cache: "no-store" });
      if (res.ok) setInfo(await res.json());
    } catch {
      // Server unreachable — leave whatever we last knew on screen.
    }
  }, []);

  useEffect(() => {
    check();
    const t = setInterval(check, CHECK_MS);
    return () => clearInterval(t);
  }, [check]);

  async function apply() {
    const was = info?.current;
    setState("updating");
    try {
      const res = await fetch("/api/update", { method: "POST" });
      if (!res.ok) throw new Error();
    } catch {
      setState("failed");
      return;
    }
    // The updater kills this server; reload once it answers on a different build
    // (a rollback keeps the same build and stays "available" for a retry).
    const deadline = Date.now() + APPLY_TIMEOUT_MS;
    const poll = async () => {
      try {
        const res = await fetch("/api/update?fresh", { cache: "no-store" });
        if (res.ok) {
          const next = (await res.json()) as UpdateInfo;
          if (next.current && next.current !== was) {
            location.reload();
            return;
          }
        }
      } catch {
        // Still down — keep waiting.
      }
      if (Date.now() > deadline) setState("failed");
      else setTimeout(poll, 2500);
    };
    setTimeout(poll, 3000);
  }

  if (!info?.canApply) return null;

  if (state === "failed")
    return (
      <button className="d-update" onClick={apply} title="The updater didn't come back — check dump.log">
        Update failed — retry
      </button>
    );

  if (state === "updating")
    return (
      <span className="d-update is-busy" role="status">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
        </svg>
        Updating…
      </span>
    );

  if (!info.available) return null;

  return (
    <button className="d-update" onClick={apply} title={`Update to ${info.latest} (you're on ${info.current})`}>
      <span className="d-update-dot" aria-hidden />
      Update{info.behind > 1 ? ` · ${info.behind}` : ""}
    </button>
  );
}
