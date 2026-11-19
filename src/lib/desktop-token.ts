import { timingSafeEqual } from "node:crypto";

// The desktop app starts the server with a per-launch secret in DUMP_DESKTOP_TOKEN and opens
// `/?dump_token=<secret>`; the window then carries it as a cookie. Without it, other Windows
// accounts on the same PC could use the library through its loopback port.
export const DESKTOP_TOKEN_PARAM = "dump_token";
export const DESKTOP_TOKEN_COOKIE = "dump_desktop";

export type DesktopAccess = "open" | "allowed" | "grant" | "denied";

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function desktopAccess(
  token: string | undefined,
  cookie: string | undefined,
  param: string | null,
): DesktopAccess {
  if (!token) return "open";
  if (cookie && same(cookie, token)) return "allowed";
  if (param && same(param, token)) return "grant";
  return "denied";
}
