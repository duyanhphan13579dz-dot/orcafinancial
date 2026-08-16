import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { hashPassword, verifyPassword } from "@/lib/auth/service";
import { revokeOtherSessions } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/users/change-password
 * Body: { currentPassword?, newPassword, confirmPassword }
 *
 * `currentPassword` is required for local accounts. Google-only accounts (no
 * password hash yet) may set an initial password without it, which also lets
 * them unlink Google later.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 10);
  if (limited) return limited;
  const authed = await getAuthedUser(req);
  if (!authed) return fail("Chưa đăng nhập", 401);

  try {
    const body = (await req.json()) as {
      currentPassword?: string;
      newPassword?: string;
      confirmPassword?: string;
    };

    const { currentPassword, newPassword, confirmPassword } = body;

    if (!newPassword || typeof newPassword !== "string") {
      return fail("Mật khẩu mới là bắt buộc", 400);
    }
    if (newPassword.length < 6) {
      return fail("Mật khẩu mới phải có ít nhất 6 ký tự", 400);
    }
    if (newPassword !== confirmPassword) {
      return fail("Mật khẩu xác nhận không khớp", 400);
    }

    const rows = await db.select().from(users).where(eq(users.id, authed.id)).limit(1);
    if (!rows.length) return fail("Không tìm thấy tài khoản", 404);
    const user = rows[0];

    if (user.passwordHash) {
      if (!currentPassword) return fail("Vui lòng nhập mật khẩu hiện tại", 400);
      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) return fail("Mật khẩu hiện tại không đúng", 401);
      if (currentPassword === newPassword) {
        return fail("Mật khẩu mới phải khác mật khẩu hiện tại", 400);
      }
    }

    const passwordHash = await hashPassword(newPassword);
    await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, user.id));

    // Security best practice: log out every other device after a password change.
    const currentToken = req.cookies.get("refreshToken")?.value;
    const revoked = await revokeOtherSessions(user.id, currentToken);

    recordAudit(req, user.id, "change_password", { revokedSessions: revoked });
    return ok({ changed: true, revokedSessions: revoked });
  } catch (err) {
    return handleError(err, "change_password");
  }
}
