import { NextRequest } from "next/server";

import {
  checkRateLimit,
  fail,
  ok,
} from "@/lib/api";

import { db } from "@/db";
import { ensureAuthTables } from "@/db/ensure-auth-tables";

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
 */
export async function POST(req: NextRequest) {
  // Auth retries after DB blips must not lock users out at 10/min.
  const limited = checkRateLimit(req, 40);
  if (limited) return limited;

  try {
    await ensureAuthTables();

    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return fail("Email và mật khẩu là bắt buộc", 400);
    }

    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.email, String(email).trim().toLowerCase()))
      .limit(1);

    if (userResult.length === 0) {
      return fail("Email hoặc mật khẩu không đúng", 401);
    }

    const user = userResult[0];

    if (!user.passwordHash) {
      return fail("Vui lòng đăng nhập bằng Google", 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);

    if (!valid) {
      return fail("Email hoặc mật khẩu không đúng", 401);
    }

    if (user.twoFactorEnabled) {
      const challenge = await generateTwoFactorChallenge({
        userId: user.id,
        provider: user.provider,
        purpose: "2fa_login",
      });

      recordAudit(req, user.id, "2fa_login_challenge_created", {
        provider: user.provider,
      });

      const response = ok({ requiresTwoFactor: true });

      response.cookies.set("orca_2fa_challenge", challenge, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 5 * 60,
        path: "/",
      });

      return response;
    }

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

    recordAudit(req, user.id, "login", {
      provider: user.provider,
    });

    const response = ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      accessToken,
    });

    response.cookies.set("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      path: "/",
    });

    return response;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Đăng nhập thất bại";
    console.error("[auth/login]", msg);
    if (
      /Failed query|relation .* does not exist|ECONNREFUSED|ECONNRESET|timeout|password authentication|SSL|connect/i.test(
        msg,
      )
    ) {
      return fail(
        "Không kết nối được cơ sở dữ liệu. Kiểm tra DATABASE_URL trên Vercel hoặc thử lại sau vài giây.",
        503,
      );
    }
    return fail("Đăng nhập thất bại. Vui lòng thử lại.", 500);
  }
}
