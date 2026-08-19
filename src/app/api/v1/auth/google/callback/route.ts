import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { ensureAuthTables } from "@/db/ensure-auth-tables";
import { refreshTokens, users } from "@/db/schema";

import {
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiresAt,
  generateTwoFactorChallenge,
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
  const url = new URL(path, getAppUrl(req));
  url.searchParams.set("error", message);
  const response = NextResponse.redirect(url);
  response.cookies.delete("orca_google_oauth_state");
  return response;
}

/** Never leak raw SQL / stack traces to the browser. */
function publicAuthError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/Failed query|relation .* does not exist|ECONNREFUSED|ECONNRESET|timeout|password authentication|SSL/i.test(msg)) {
    return "Không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau vài giây.";
  }
  if (msg.length > 180) return "Đăng nhập Google thất bại. Vui lòng thử lại.";
  return msg || "Đăng nhập Google thất bại";
}

async function createSession(
  req: NextRequest,
  user: typeof users.$inferSelect,
): Promise<NextResponse> {
  const accessToken = await generateAccessToken({
    userId: user.id,
    email: user.email,
    provider: user.provider,
  });

  const refreshToken = generateRefreshToken();
  const expiresAt = getRefreshTokenExpiresAt();

  await db.insert(refreshTokens).values({
    token: refreshToken,
    userId: user.id,
    expiresAt,
  });

  await upsertSession({
    userId: user.id,
    token: refreshToken,
    userAgent: req.headers.get("user-agent"),
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    expiresAt,
  });

  const response = NextResponse.redirect(new URL("/", getAppUrl(req)));

  response.cookies.set("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60,
    path: "/",
  });

  return response;
}

/**
 * GET /api/v1/auth/google/callback
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const googleError = req.nextUrl.searchParams.get("error");

  if (googleError) {
    return redirectWithError(req, "/auth/login", `Google OAuth: ${googleError}`);
  }

  if (!code || !state) {
    return redirectWithError(req, "/auth/login", "Google OAuth callback không hợp lệ");
  }

  const storedState = req.cookies.get("orca_google_oauth_state")?.value;

  if (!storedState || storedState !== state) {
    return redirectWithError(
      req,
      "/auth/login",
      "Phiên Google OAuth đã hết hạn hoặc không hợp lệ",
    );
  }

  const oauthState = await verifyGoogleOAuthState(state);

  if (!oauthState) {
    return redirectWithError(req, "/auth/login", "Google OAuth state không hợp lệ");
  }

  try {
    // Ensure auth schema exists before any user query (cold start / missed migration).
    await ensureAuthTables();

    const redirectUri = `${getAppUrl(req)}/api/v1/auth/google/callback`;

    const { idToken } = await exchangeGoogleCode(code, redirectUri);
    const google = await verifyGoogleIdToken(idToken);

    if (oauthState.mode === "link") {
      const currentUserId = oauthState.userId;

      if (!currentUserId) {
        return redirectWithError(
          req,
          "/settings?tab=account",
          "Không xác định được tài khoản Orca",
        );
      }

      const currentUser = await getAuthedUser(req);

      if (!currentUser || currentUser.id !== currentUserId) {
        return redirectWithError(
          req,
          "/auth/login",
          "Phiên đăng nhập đã thay đổi. Vui lòng đăng nhập lại.",
        );
      }

      const existingRows = await db
        .select()
        .from(users)
        .where(eq(users.email, google.email))
        .limit(1);

      const existing = existingRows[0];

      if (existing && existing.id !== currentUserId) {
        return redirectWithError(
          req,
          "/settings?tab=account",
          "Google này đã được sử dụng bởi một tài khoản ORCA khác.",
        );
      }

      const updated = await db
        .update(users)
        .set({
          provider: "google",
          name: currentUser.name || google.name || null,
          avatarUrl: google.picture || currentUser.avatarUrl || null,
          emailVerified: true,
          updatedAt: new Date(),
        })
        .where(eq(users.id, currentUserId))
        .returning();

      if (!updated.length) {
        return redirectWithError(
          req,
          "/settings?tab=account",
          "Không thể liên kết Google.",
        );
      }

      recordAudit(req, currentUserId, "link_google", {
        googleEmail: google.email,
        googleSubject: google.sub,
      });

      return NextResponse.redirect(
        new URL("/settings?tab=account&google=linked", getAppUrl(req)),
      );
    }

    const existingRows = await db
      .select()
      .from(users)
      .where(eq(users.email, google.email))
      .limit(1);

    let user = existingRows[0];

    if (!user) {
      const inserted = await db
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
      const updated = await db
        .update(users)
        .set({
          provider: "google",
          emailVerified: true,
          name: user.name || google.name || null,
          avatarUrl: user.avatarUrl || google.picture || null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();

      if (updated.length) {
        user = updated[0];
      }
    }

    if (user.twoFactorEnabled) {
      const challenge = await generateTwoFactorChallenge({
        userId: user.id,
        provider: user.provider,
        purpose: "2fa_login",
      });

      recordAudit(req, user.id, "2fa_login_challenge_created", {
        provider: "google",
      });

      const response = NextResponse.redirect(
        new URL("/auth/2fa", getAppUrl(req)),
      );

      response.cookies.set("orca_2fa_challenge", challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 5 * 60,
        path: "/",
      });

      response.cookies.delete("orca_google_oauth_state");

      return response;
    }

    recordAudit(req, user.id, "login", {
      provider: "google",
      googleEmail: google.email,
      googleSubject: google.sub,
    });

    return createSession(req, user);
  } catch (error) {
    console.error("[google-callback]", error);
    return redirectWithError(req, "/auth/login", publicAuthError(error));
  }
}
