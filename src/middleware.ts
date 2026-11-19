import { NextResponse, type NextRequest } from "next/server";
import { DESKTOP_TOKEN_COOKIE, DESKTOP_TOKEN_PARAM, desktopAccess } from "@/lib/desktop-token";

export function middleware(req: NextRequest) {
  const token = process.env.DUMP_DESKTOP_TOKEN;
  const access = desktopAccess(
    token,
    req.cookies.get(DESKTOP_TOKEN_COOKIE)?.value,
    req.nextUrl.searchParams.get(DESKTOP_TOKEN_PARAM),
  );
  if (access === "open" || access === "allowed") return NextResponse.next();
  if (access === "denied") return new NextResponse("Forbidden", { status: 403 });

  // No redirect to strip the param: behind `next start`, redirects point at "localhost", not 127.0.0.1.
  const res = NextResponse.next();
  // Lax, not Strict: the token arrives on the navigation from the app's splash page, another site.
  res.cookies.set(DESKTOP_TOKEN_COOKIE, token!, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}

export const config = { runtime: "nodejs" };
