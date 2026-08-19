import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  refreshTokens,
  users,
} from "@/db/schema";
import {
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiresAt,
} from "@/lib/auth/service";
import {
  getAuthedUser,
  recordAudit,
} from "@/lib/auth/guard";
import {
  exchangeGoogleCode,
  verifyGoogleIdToken,
  verifyGoogleOAuthState,
} from "@/lib/auth/google";
import { upsertSession } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

function getAppUrl(req: NextRequest): string {
  return (
    process.env.APP_URL?.trim().replace(/\/+$/, "") ||
    req.nextUrl.origin
  );
}

function redirectWithError(
  req: NextRequest,
  path: string,
  message: string,
): NextResponse {
  const url = new URL(
    path,
    getAppUrl(req),
  );

  url.searchParams.set(
    "error",
    message,
  );

  const response =
    NextResponse.redirect(url);

  response.cookies.delete(
    "orca_google_oauth_state",
  );

  return response;
}

function redirectSuccess(
  req: NextRequest,
  path: string,
): NextResponse {
  const response =
    NextResponse.redirect(
      new URL(path, getAppUrl(req)),
    );

  response.cookies.delete(
    "orca_google_oauth_state",
  );

  return response;
}

/**
 * Create Orca session after successful Google authentication.
 */
async function createSession(
  req: NextRequest,
  user: typeof users.$inferSelect,
): Promise<NextResponse> {
  const accessToken =
    await generateAccessToken({
      userId: user.id,
      email: user.email,
      provider: user.provider,
    });

  const refreshToken =
    generateRefreshToken();

  const expiresAt =
    getRefreshTokenExpiresAt();

  await db
    .insert(refreshTokens)
    .values({
      token: refreshToken,
      userId: user.id,
      expiresAt,
    });

  await upsertSession({
    userId: user.id,
    token: refreshToken,
    userAgent:
      req.headers.get("user-agent"),
    ipAddress:
      req.headers
        .get("x-forwarded-for")
        ?.split(",")[0]
        ?.trim() ??
      null,
    expiresAt,
  });

  const response =
    NextResponse.redirect(
      new URL("/", getAppUrl(req)),
    );

  response.cookies.set(
    "refreshToken",
    refreshToken,
    {
      httpOnly: true,
      secure:
        process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    },
  );

  return response;
}

/**
 * GET /api/v1/auth/google/callback
 */
export async function GET(
  req: NextRequest,
) {
  const code =
    req.nextUrl.searchParams.get(
      "code",
    );

  const state =
    req.nextUrl.searchParams.get(
      "state",
    );

  const googleError =
    req.nextUrl.searchParams.get(
      "error",
    );

  if (googleError) {
    return redirectWithError(
      req,
      "/auth/login",
      `Google OAuth: ${googleError}`,
    );
  }

  if (!code || !state) {
    return redirectWithError(
      req,
      "/auth/login",
      "Google OAuth callback không hợp lệ",
    );
  }

  const storedState =
    req.cookies.get(
      "orca_google_oauth_state",
    )?.value;

  /*
   * State must match both:
   * 1. the signed JWT;
   * 2. the httpOnly browser cookie.
   *
   * This prevents a forged OAuth callback from
   * attaching a Google identity to another account.
   */
  if (
    !storedState ||
    storedState !== state
  ) {
    return redirectWithError(
      req,
      "/auth/login",
      "Phiên Google OAuth đã hết hạn hoặc không hợp lệ",
    );
  }

  const oauthState =
    await verifyGoogleOAuthState(
      state,
    );

  if (!oauthState) {
    return redirectWithError(
      req,
      "/auth/login",
      "Google OAuth state không hợp lệ",
    );
  }

  try {
    const redirectUri =
      `${getAppUrl(req)}/api/v1/auth/google/callback`;

    const { idToken } =
      await exchangeGoogleCode(
        code,
        redirectUri,
      );

    const google =
      await verifyGoogleIdToken(
        idToken,
      );

    /*
     * ─────────────────────────────
     * LINK EXISTING ORCA ACCOUNT
     * ─────────────────────────────
     */
    if (oauthState.mode === "link") {
      const currentUserId =
        oauthState.userId;

      if (!currentUserId) {
        return redirectWithError(
          req,
          "/settings?tab=account",
          "Không xác định được tài khoản Orca",
        );
      }

      const currentUser =
        await getAuthedUser(req);

      if (
        !currentUser ||
        currentUser.id !== currentUserId
      ) {
        return redirectWithError(
          req,
          "/auth/login",
          "Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.",
        );
      }

      const existingRows =
        await db
          .select()
          .from(users)
          .where(
            eq(
              users.email,
              google.email,
            ),
          )
          .limit(1);

      const existing =
        existingRows[0];

      /*
       * If the Google email already belongs to
       * another Orca account, never merge accounts
       * automatically.
       */
      if (
        existing &&
        existing.id !== currentUserId
      ) {
        return redirectWithError(
          req,
          "/settings?tab=account",
          "Google này đã được sử dụng bởi một tài khoản ORCA khác.",
        );
      }

      /*
       * If the current account already uses Google,
       * simply refresh Google profile information.
       *
       * passwordHash is intentionally preserved,
       * so a local account can continue using
       * email/password after linking Google.
       */
      const updated =
        await db
          .update(users)
          .set({
            provider: "google",
            name:
              currentUser.name ||
              google.name ||
              null,
            avatarUrl:
              google.picture ||
              currentUser.avatarUrl ||
              null,
            emailVerified: true,
            updatedAt: new Date(),
          })
          .where(
            eq(
              users.id,
              currentUserId,
            ),
          )
          .returning();

      if (!updated.length) {
        return redirectWithError(
          req,
          "/settings?tab=account",
          "Không thể liên kết Google.",
        );
      }

      recordAudit(
        req,
        currentUserId,
        "link_google",
        {
          googleEmail: google.email,
          googleSubject: google.sub,
        },
      );

      return redirectSuccess(
        req,
        "/settings?tab=account&google=linked",
      );
    }

    /*
     * ─────────────────────────────
     * GOOGLE LOGIN
     * ─────────────────────────────
     */

    const existingRows =
      await db
        .select()
        .from(users)
        .where(
          eq(
            users.email,
            google.email,
          ),
        )
        .limit(1);

    let user =
      existingRows[0];

    if (!user) {
      const inserted =
        await db
          .insert(users)
          .values({
            email: google.email,
            passwordHash: null,
            name: google.name,
            avatarUrl: google.picture,
            provider: "google",
            emailVerified: true,
          })
          .returning();

      user = inserted[0];
    } else {
      /*
       * Existing account:
       *
       * - keep passwordHash if present;
       * - mark Google as available;
       * - refresh Google profile information only
       *   where useful.
       */
      const updated =
        await db
          .update(users)
          .set({
            provider: "google",
            emailVerified: true,
            name:
              user.name ||
              google.name ||
              null,
            avatarUrl:
              user.avatarUrl ||
              google.picture ||
              null,
            updatedAt: new Date(),
          })
          .where(
            eq(
              users.id,
              user.id,
            ),
          )
          .returning();

      if (updated.length) {
        user = updated[0];
      }
    }

    recordAudit(
      req,
      user.id,
      "login",
      {
        provider: "google",
        googleEmail: google.email,
        googleSubject: google.sub,
      },
    );

    return createSession(
      req,
      user,
    );
  } catch (error) {
    console.error(
      "[google-callback]",
      error,
    );

    return redirectWithError(
      req,
      "/auth/login",
      error instanceof Error
        ? error.message
        : "Đăng nhập Google thất bại",
    );
  }
}
