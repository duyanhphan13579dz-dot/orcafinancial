import { NextRequest, NextResponse } from "next/server";

/**
 * Global auth gate: every product module requires a session.
 *
 * Public:
 * - `/` marketing landing (logged-out home)
 * - `/auth/*` login / register / 2FA UI
 * - `/api/v1/auth/*` auth APIs (login, register, Google OAuth, 2FA)
 * - `/api/health*` ops health probes
 * - static / Next internals
 *
 * Everything else needs `refreshToken` cookie or `Authorization: Bearer`.
 */

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  ) {
    return true;
  }

  if (pathname.startsWith("/auth")) return true;

  if (pathname.startsWith("/api/v1/auth")) return true;

  if (pathname.startsWith("/api/health")) return true;

  return false;
}

function hasAuthorizedCronSecret(req: NextRequest, pathname: string): boolean {
  if (pathname !== "/api/internal/financial-period-audit" && pathname !== "/api/internal/financial-data-cleanup" && pathname !== "/api/internal/financial-ingest" && pathname !== "/api/internal/financial-llm") return false;
  const secret = process.env.FINANCIAL_AUDIT_SECRET ?? process.env.CRON_SECRET;
  const authorization = req.headers.get("authorization");
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

function hasSession(req: NextRequest): boolean {
  const refresh = req.cookies.get("refreshToken")?.value;
  if (refresh && refresh.length > 10) return true;

  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.length > 20) return true;

  return false;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublicPath(pathname) || hasAuthorizedCronSecret(req, pathname)) {
    return NextResponse.next();
  }

  if (hasSession(req)) {
    return NextResponse.next();
  }

  // API: JSON 401 (do not redirect browsers calling fetch)
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: "Unauthorized. Vui lòng đăng nhập để sử dụng API.",
        meta: {
          code: "AUTH_REQUIRED",
          timestamp: new Date().toISOString(),
        },
      },
      { status: 401 },
    );
  }

  // Pages: redirect to login with return URL
  const login = new URL("/auth/login", req.url);
  const next = pathname + (req.nextUrl.search || "");
  if (next && next !== "/") {
    login.searchParams.set("next", next);
  }
  return NextResponse.redirect(login);
}

export const config = {
  matcher: [
    /*
     * Match all paths except static assets handled by the edge.
     * isPublicPath still allows `/` and auth routes through.
     */
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
