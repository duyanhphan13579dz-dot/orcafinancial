import { NextRequest } from "next/server";
import { checkRateLimit, fail, ok } from "@/lib/api";
import { db, safeDbQuery } from "@/db";
import { ensureAuthTables } from "@/db/ensure-auth-tables";
import { users, refreshTokens } from "@/db/schema";
import {
  hashPassword,
  generateAccessToken,
  generateRefreshToken,
  getRefreshTokenExpiresAt,
} from "@/lib/auth/service";
import { upsertSession } from "@/lib/settings/service";
import { recordAudit } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/register
 * Body: { email, password, name? }
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 10);
  if (limited) return limited;

  try {
    await ensureAuthTables();

    const body = await req.json();
    const { email, password, name } = body;

    if (!email || !password) {
      return fail("Email và mật khẩu là bắt buộc", 400);
    }

    if (password.length < 6) {
      return fail("Mật khẩu phải có ít nhất 6 ký tự", 400);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const passwordHash = await hashPassword(password);

    const result = await safeDbQuery(
      "auth_register_insert_user",
      () => db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        name: name || null,
        provider: "local",
        emailVerified: false,
      })
      .returning({
        id: users.id,
        email: users.email,
        name: users.name,
        provider: users.provider,
        avatarUrl: users.avatarUrl,
      }),
      { attempts: 2, baseMs: 200 },
    );

    const user = result[0];

    const accessToken = await generateAccessToken({
      userId: user.id,
      email: user.email,
      provider: user.provider,
    });
    const refreshToken = generateRefreshToken();
    const expiresAt = getRefreshTokenExpiresAt();

    await safeDbQuery(
      "auth_register_insert_refresh",
      () => db.insert(refreshTokens).values({
        token: refreshToken,
        userId: user.id,
        expiresAt,
      }),
      { attempts: 2, baseMs: 200 },
    );

    // Session listing is secondary to the refresh-token cookie and must not
    // delay the successful registration response.
    void upsertSession({
      userId: user.id,
      token: refreshToken,
      userAgent: req.headers.get("user-agent"),
      ipAddress:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      expiresAt,
    });

    recordAudit(req, user.id, "register", { provider: "local" });

    const response = ok({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        provider: user.provider,
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
    const msg = err instanceof Error ? err.message : "Đăng ký thất bại";
    if (/Failed query|relation .* does not exist|ECONNREFUSED|ECONNRESET/i.test(msg)) {
      return fail("Không kết nối được cơ sở dữ liệu. Vui lòng thử lại sau.", 503);
    }
    if (/duplicate key|unique constraint|23505/i.test(msg)) {
      return fail("Email đã được đăng ký", 409);
    }
    return fail(msg, 500);
  }
}
