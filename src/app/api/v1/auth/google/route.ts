import { NextRequest, NextResponse } from "next/server";
import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthState,
  createOAuthNonce,
} from "@/lib/auth/google";
import { getAuthedUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

function getAppUrl(req: NextRequest): string {
  return (
    process.env.APP_URL?.trim().replace(/\/+$/, "") ||
    req.nextUrl.origin
  );
}

/**
 * GET /api/v1/auth/google?mode=login
 *
 * Starts Google login.
 *
 * GET /api/v1/auth/google?mode=link
 *
 * Starts Google account linking for the currently authenticated user.
 */
export async function GET(req: NextRequest) {
  try {
    const requestedMode =
      req.nextUrl.searchParams.get("mode") || "login";

    const mode =
      requestedMode === "link"
        ? "link"
        : "login";

    let userId: string | undefined;

    if (mode === "link") {
      const user = await getAuthedUser(req);

      if (!user) {
        const loginUrl = new URL(
          "/auth/login",
          getAppUrl(req),
        );

        loginUrl.searchParams.set(
          "error",
          "login_required",
        );

        return NextResponse.redirect(loginUrl);
      }

      userId = user.id;
    }

    const nonce = createOAuthNonce();

    const state = await createGoogleOAuthState({
      mode,
      userId,
      nonce,
    });

    const redirectUri =
      `${getAppUrl(req)}/api/v1/auth/google/callback`;

    const authorizationUrl =
      buildGoogleAuthorizationUrl(
        redirectUri,
        state,
      );

    const response =
      NextResponse.redirect(
        authorizationUrl,
      );

    /*
     * SameSite=Lax allows the cookie to survive the
     * normal top-level OAuth redirect while remaining
     * protected against most cross-site requests.
     */
    response.cookies.set(
      "orca_google_oauth_state",
      state,
      {
        httpOnly: true,
        secure:
          process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 10 * 60,
        path: "/",
      },
    );

    return response;
  } catch (error) {
    const loginUrl = new URL(
      "/auth/login",
      getAppUrl(req),
    );

    loginUrl.searchParams.set(
      "error",
      error instanceof Error
        ? error.message
        : "Google OAuth chưa được cấu hình",
    );

    return NextResponse.redirect(loginUrl);
  }
}
