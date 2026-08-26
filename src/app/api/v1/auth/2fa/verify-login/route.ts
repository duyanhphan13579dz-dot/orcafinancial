import { NextRequest } from "next/server";
import { and, eq, gt } from "drizzle-orm";

import { db, safeDbQuery } from "@/db";
import {
  refreshTokens,
  users,
} from "@/db/schema";

import {
  fail,
  ok,
  checkRateLimit,
} from "@/lib/api";

import {
  verifyTwoFactorChallenge,
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiresAt,
} from "@/lib/auth/service";

import {
  decryptTotpSecret,
  verifyTotpCode,
} from "@/lib/auth/two-factor";

import {
  recordAudit,
} from "@/lib/auth/guard";

import {
  upsertSession,
} from "@/lib/settings/service";

export const dynamic =
  "force-dynamic";

export async function POST(
  req: NextRequest,
) {
  const limited =
    checkRateLimit(req, 8);

  if (limited) {
    return limited;
  }

  const challenge =
    req.cookies.get(
      "orca_2fa_challenge",
    )?.value;

  if (!challenge) {
    return fail(
      "Phiên xác thực 2FA không tồn tại hoặc đã hết hạn",
      401,
    );
  }

  const challengePayload =
    await verifyTwoFactorChallenge(
      challenge,
    );

  if (!challengePayload) {
    const response = fail(
      "Phiên xác thực 2FA không hợp lệ hoặc đã hết hạn",
      401,
    );

    response.cookies.delete(
      "orca_2fa_challenge",
    );

    return response;
  }

  try {
    const body =
      await req.json();

    const code = String(
      body?.code ?? "",
    )
      .replace(/\s/g, "")
      .trim();

    if (!/^\d{6}$/.test(code)) {
      return fail(
        "Mã xác thực phải gồm 6 chữ số",
        400,
      );
    }

    const rows =
      await db
        .select()
        .from(users)
        .where(
          eq(
            users.id,
            challengePayload.userId,
          ),
        )
        .limit(1);

    const user = rows[0];

    if (!user) {
      return fail(
        "Tài khoản không tồn tại",
        401,
      );
    }

    /*
     * Re-check 2FA status from DB.
     *
     * Never trust the challenge alone.
     */
    if (!user.twoFactorEnabled) {
      const response = fail(
        "2FA không còn được bật cho tài khoản này",
        400,
      );

      response.cookies.delete(
        "orca_2fa_challenge",
      );

      return response;
    }

    if (!user.twoFactorSecret) {
      return fail(
        "Cấu hình 2FA không hợp lệ",
        401,
      );
    }

    const secret =
      decryptTotpSecret(
        user.twoFactorSecret,
      );

    const valid =
      verifyTotpCode(
        secret,
        code,
      );

    if (!valid) {
      recordAudit(
        req,
        user.id,
        "2fa_login_failed",
        {
          provider:
            challengePayload.provider,
        },
      );

      return fail(
        "Mã xác thực không đúng hoặc đã hết hạn",
        401,
      );
    }

    /*
     * TOTP is now verified.
     *
     * Only NOW create the real session.
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

    await safeDbQuery(
      "auth_2fa_insert_refresh",
      () => db
        .insert(refreshTokens)
        .values({
          token: refreshToken,
          userId: user.id,
          expiresAt,
        }),
      { attempts: 2, baseMs: 200 },
    );

    // The refresh-token row authenticates the browser; session history is
    // secondary and should not increase sign-in latency.
    void upsertSession({
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
        provider:
          challengePayload.provider,
        mfa: "totp",
      },
    );

    const response = ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl:
          user.avatarUrl,
      },
      accessToken,
      twoFactorVerified: true,
    });

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

    /*
     * Challenge becomes unusable
     * from the browser after successful login.
     */
    response.cookies.delete(
      "orca_2fa_challenge",
    );

    return response;
  } catch (error) {
    console.error(
      "[2fa/verify-login]",
      error,
    );

    return fail(
      "Không thể xác thực 2FA",
      500,
    );
  }
}
