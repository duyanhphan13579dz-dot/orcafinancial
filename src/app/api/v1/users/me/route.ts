import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { deleteAccount } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/users/me — current profile */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);
  return ok({ user });
}

/** PATCH /api/v1/users/me — update name / avatar / phone */
export async function PATCH(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const body = (await req.json()) as {
      name?: unknown;
      avatarUrl?: unknown;
      phoneNumber?: unknown;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.length > 255) {
        return fail("Tên không hợp lệ (tối đa 255 ký tự)", 400);
      }
      patch.name = body.name.trim() || null;
    }
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl !== null && (typeof body.avatarUrl !== "string" || body.avatarUrl.length > 500)) {
        return fail("Đường dẫn ảnh không hợp lệ", 400);
      }
      patch.avatarUrl = body.avatarUrl || null;
    }
    if (body.phoneNumber !== undefined) {
      if (body.phoneNumber !== null && typeof body.phoneNumber !== "string") {
        return fail("Số điện thoại không hợp lệ", 400);
      }
      const phone = (body.phoneNumber as string | null)?.trim() || null;
      if (phone && !/^[0-9+\-\s().]{6,30}$/.test(phone)) {
        return fail("Số điện thoại không hợp lệ", 400);
      }
      patch.phoneNumber = phone;
    }

    const rows = await db.update(users).set(patch).where(eq(users.id, user.id)).returning();
    recordAudit(req, user.id, "update_profile", { fields: Object.keys(patch).filter((k) => k !== "updatedAt") });

    const u = rows[0];
    return ok({
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        avatarUrl: u.avatarUrl,
        phoneNumber: u.phoneNumber,
        provider: u.provider,
        emailVerified: u.emailVerified,
        twoFactorEnabled: u.twoFactorEnabled,
        createdAt: u.createdAt,
      },
    });
  } catch (err) {
    return handleError(err, "users_me_patch");
  }
}

/** DELETE /api/v1/users/me — permanently delete account */
export async function DELETE(req: NextRequest) {
  const limited = checkRateLimit(req, 5);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const body = (await req.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== user.email) {
      return fail("Vui lòng nhập chính xác email để xác nhận xoá tài khoản", 400);
    }
    recordAudit(req, user.id, "delete_account");
    await deleteAccount(user.id);
    const res = ok({ deleted: true });
    res.cookies.delete("refreshToken");
    return res;
  } catch (err) {
    return handleError(err, "users_me_delete");
  }
}
