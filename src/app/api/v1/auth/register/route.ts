import { NextRequest } from "next/server";
import { checkRateLimit, fail, ok } from "@/lib/api";
import { db } from "@/db";
import { users, refreshTokens } from "@/db/schema";
import { hashPassword, generateAccessToken, generateRefreshToken, getRefreshTokenExpiresAt } from "@/lib/auth/service";
import { eq } from "drizzle-orm";
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
    const body = await req.json();
    const { email, password, name } = body;

    if (!email || !password) {
      return fail("Email và mật khẩu là bắt buộc", 400);
    }

    if (password.length < 6) {
      return fail("Mật khẩu phải có ít nhất 6 ký tự", 400);
    }

    // Check if user exists
    const existing = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing.length > 0) {
      return fail("Email đã được đăng ký", 409);
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user
    const result = await db
      .insert(users)
      .values({
        email: email.toLowerCase(),
        passwordHash,
        name: name || null,
        provider: "local",
        emailVerified: false,
      })
      .returning({ id: users.id, email: users.email, name: users.name, provider: users.provider });

    const user = result[0];

    // Generate tokens
    const accessToken = await generateAccessToken({
      userId: user.id,
      email: user.email,
      provider: user.provider,
    });
    const refreshToken = generateRefreshToken();
    const expiresAt = getRefreshTokenExpiresAt();

    // Save refresh token
    await db.insert(refreshTokens).values({
      token: refreshToken,
      userId: user.id,
      expiresAt,
    });

    await upsertSession({
      userId: user.id,
      token: refreshToken,
      userAgent: req.headers.get("user-agent"),
      ipAddress: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      expiresAt,
    });
    recordAudit(req, user.id, "register", { provider: "local" });

    // Set cookies
    const response = ok({
      user: { id: user.id, email: user.email, name: user.name },
      accessToken,
    });

    response.cookies.set("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: "/",
    });

    return response;
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Đăng ký thất bại", 500);
  }
}
