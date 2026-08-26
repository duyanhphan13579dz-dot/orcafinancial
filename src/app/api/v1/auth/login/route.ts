import { NextRequest } from "next/server";

import { checkRateLimit, fail, ok } from "@/lib/api";

import { db, safeDbQuery } from "@/db";
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
 * Rate limiting is kept in-memory and independent from database availability.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 10);
  if (limited) return limited;

  try {
    await ensureAuthTables();

    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return fail("Email và mật khẩu là bắt buộc", 400);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const userResult = await safeDbQuery(
      "auth_login_select_user",
      () =>
        db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
            provider: users.provider,
            passwordHash: users.passwordHash,
            twoFactorEnabled: users.twoFactorEnabled,
          })
          .from(users)
          .where(eq(users.email, normalizedEmail))
          .limit(1),
      { attempts: 2, baseMs: 200 },
    );

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

    await safeDbQuery(
      "auth_login_insert_refresh",
      () =>
        db.insert(refreshTokens).values({
          token: refreshToken,
          userId: user.id,
          expiresAt,
        }),
      { attempts: 2, baseMs: 200 },
    );

    // The refresh token is the authentication source of truth. The device
    // session index is secondary and must not add another network round trip.
    void upsertSession({
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
      /Failed query|relation .* does not exist|ECONNREFUSED|ECONNRESET|timeout|password authentication|SSL|connect|pool_connect/i.test(
        msg,
      )
    ) {
      return fail(
        "Không kết nối được cơ sở dữ liệu. Kiểm tra DATABASE_URL (Supabase pooler :6543 + pgbouncer=true) trên Vercel rồi redeploy.",
        503,
      );
    }
    if (/duplicate key|unique constraint|23505/i.test(msg)) {
      return fail("Phiên đăng nhập đã tồn tại. Vui lòng thử lại.", 409);
    }
    return fail("Đăng nhập thất bại. Vui lòng thử lại.", 500);
  }
}
