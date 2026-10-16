import { NextResponse, type NextRequest } from "next/server";
import { can, requiredPerm } from "@/lib/acm";
import { COOKIE, verifySession } from "@/lib/auth";
import { config as settings, verifyKey } from "@/lib/settings";

// The banking app (/api/transactions) and demo controls are called without a console session.
const PUBLIC = ["/login", "/favicon.ico", "/api/auth/", "/api/transactions/", "/api/events/", "/api/flows/", "/api/demo/", "/api/openapi"];

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const user = verifySession(req.cookies.get(COOKIE)?.value);
  if (pathname === "/login" && user) return NextResponse.redirect(new URL("/", req.url));
  // Settings → API: when required, the banking channel must send a valid X-API-Key.
  if ((pathname.startsWith("/api/transactions/") || pathname.startsWith("/api/events/") || pathname.startsWith("/api/flows/")) && settings().api.requireApiKey && !verifyKey(req.headers.get("x-api-key")))
    return Response.json({ error: "Missing or invalid API key.", code: "INVALID_API_KEY" }, { status: 401 });
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (user) {
    // Live ACM check: a revoked permission or disabled account takes effect on the next request, not at next login.
    if (can(user, requiredPerm(req.method, pathname, search))) return NextResponse.next();
    if (pathname.startsWith("/api/")) return Response.json({ error: "Forbidden: you do not have access to this action." }, { status: 403 });
    return NextResponse.rewrite(new URL("/forbidden", req.url));
  }
  if (pathname.startsWith("/api/")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const to = new URL("/login", req.url);
  to.searchParams.set("next", pathname + search);
  return NextResponse.redirect(to);
}

// Skip framework internals, metadata routes, and static assets. Without the asset extension this
// middleware also ran for public/ files and redirected them to /login, so images never loaded.
export const config = {
  matcher: ["/((?!_next/|favicon\\.ico|[^/]+\\.(?:png|jpe?g|gif|svg|webp|avif|ico|txt|xml|webmanifest|woff2?|ttf|otf|json|map)$).*)"],
};
