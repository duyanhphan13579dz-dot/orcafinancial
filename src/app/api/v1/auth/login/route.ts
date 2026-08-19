import { NextRequest } from "next/server";

import {
  checkRateLimit,
  fail,
  ok,
} from "@/lib/api";

import { db } from "@/db";

import {
  users,
  refreshTokens,
} from "@/db/schema";

import {
  verifyPassword,
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiresAt,
  generateTwoFactorChallenge,
} from "@/lib/auth/service";

import { eq } from "drizzle-orm";

import { upsertSession } from "@/lib/settings/service";

import { recordAudit } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/login
 *
 * Body:
 * {
 *   email,
 *   password
 * }
 */
export async function POST(
  req: NextRequest,
) {
  const limited = checkRateLimit(
    req,
    10,
  );

  if (limited) {
    return limited;
  }

  try {
    const body = await req.json();

    const {
      email,
      password,
    } = body;

    if (!email || !password) {
      return fail(
        "Email và mật khẩu là bắt buộc",
        400,
      );
    }

    /*
     * Find user.
     */
    const userResult = await db
      .select()
      .from(users)
      .where(
        eq(
          users.email,
          email.toLowerCase(),
        ),
      )
      .limit(1);

    if (userResult.length === 0) {
      return fail(
        "Email hoặc mật khẩu không đúng",
        401,
      );
    }

    const user = userResult[0];

    /*
     * Google-only users do not have a password.
     */
    if (!user.passwordHash) {
      return fail(
        "Vui lòng đăng nhập bằng Google",
        401,
      );
    }

    /*
     * Verify password.
     */
    const valid = await verifyPassword(
      password,
      user.passwordHash,
    );

    if (!valid) {
      return fail(
        "Email hoặc mật khẩu không đúng",
        401,
      );
    }

    /*
     * ─────────────────────────────
     * 2FA ENFORCEMENT
     * ─────────────────────────────
     *
     * Password verification has succeeded,
     * but authentication is NOT complete yet.
     *
     * Therefore:
     *
     * - no access token
     * - no refresh token
     * - no session
     *
     * until TOTP is verified.
     */
    if (user.twoFactorEnabled) {
      const challenge =
        await generateTwoFactorChallenge({
          userId: user.id,
          provider: user.provider,
          purpose: "2fa_login",
        });

      recordAudit(
        req,
        user.id,
        "2fa_login_challenge_created",
        {
          provider: user.provider,
        },
      );

      const response = ok({
        requiresTwoFactor: true,
      });

      response.cookies.set(
        "orca_2fa_challenge",
        challenge,
        {
          httpOnly: true,
          secure:
            process.env.NODE_ENV ===
            "production",
          sameSite: "lax",
          maxAge: 5 * 60,
          path: "/",
        },
      );

      return response;
    }

    /*
     * ─────────────────────────────
     * FULL SESSION
     * ─────────────────────────────
     *
     * Only reached when 2FA is disabled.
     */

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

    /*
     * Save refresh token.
     */
    await db
      .insert(refreshTokens)
      .values({
        token: refreshToken,
        userId: user.id,
        expiresAt,
      });

    /*
     * Track this device/browser as a session.
     */
    await upsertSession({
      userId: user.id,
      token: refreshToken,
      userAgent:
        req.headers.get(
          "user-agent",
        ),
      ipAddress:
        req.headers
          .get("x-forwarded-for")
          ?.split(",")[0]
          ?.trim() ?? null,
      expiresAt,
    });

    recordAudit(
      req,
      user.id,
      "login",
      {
        provider: user.provider,
      },
    );

    /*
     * Return authenticated user.
     */
    const response = ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      accessToken,
    });

    /*
     * Refresh token is httpOnly and cannot be
     * accessed by browser JavaScript.
     */
    response.cookies.set(
      "refreshToken",
      refreshToken,
      {
        httpOnly: true,
        secure:
          process.env.NODE_ENV ===
          "production",
        sameSite: "lax",
        maxAge:
          7 * 24 * 60 * 60,
        path: "/",
      },
    );

    return response;
  } catch (err) {
    return fail(
      err instanceof Error
        ? err.message
        : "Đăng nhập thất bại",
      500,
    );
  }
}
