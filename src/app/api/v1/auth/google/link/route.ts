import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  checkRateLimit,
  fail,
  handleError,
  ok,
} from "@/lib/api";
import {
  getAuthedUser,
  recordAudit,
} from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/v1/auth/google/link
 *
 * Unlinks Google from the current ORCA account.
 *
 * Safety rule:
 * A pure Google account without a password cannot
 * unlink Google because doing so would leave the
 * account without a login method.
 */
export async function DELETE(
  req: NextRequest,
) {
  const limited =
    checkRateLimit(req, 10);

  if (limited) {
    return limited;
  }

  const currentUser =
    await getAuthedUser(req);

  if (!currentUser) {
    return fail(
      "Chưa đăng nhập",
      401,
    );
  }

  try {
    const rows =
      await db
        .select()
        .from(users)
        .where(
          eq(
            users.id,
            currentUser.id,
          ),
        )
        .limit(1);

    const user =
      rows[0];

    if (!user) {
      return fail(
        "Không tìm thấy tài khoản",
        404,
      );
    }

    if (
      user.provider !==
      "google"
    ) {
      return fail(
        "Tài khoản Google chưa được liên kết",
        400,
      );
    }

    /*
     * Google-only account:
     *
     * passwordHash === null
     *
     * Cannot unlink because there would be no
     * password-based login remaining.
     */
    if (!user.passwordHash) {
      return fail(
        "Tài khoản này chỉ đăng nhập bằng Google. Hãy đặt mật khẩu trước khi hủy liên kết Google.",
        400,
      );
    }

    const updated =
      await db
        .update(users)
        .set({
          provider: "local",
          updatedAt:
            new Date(),
        })
        .where(
          eq(
            users.id,
            user.id,
          ),
        )
        .returning();

    if (!updated.length) {
      return fail(
        "Không thể hủy liên kết Google",
        500,
      );
    }

    recordAudit(
      req,
      user.id,
      "unlink_google",
      {
        email: user.email,
      },
    );

    return ok({
      linked: false,
      user: {
        id: updated[0].id,
        email:
          updated[0].email,
        name:
          updated[0].name,
        avatarUrl:
          updated[0].avatarUrl,
        phoneNumber:
          updated[0].phoneNumber,
        provider:
          updated[0].provider,
        emailVerified:
          updated[0].emailVerified,
        twoFactorEnabled:
          updated[0]
            .twoFactorEnabled,
        createdAt:
          updated[0]
            .createdAt,
      },
    });
  } catch (error) {
    return handleError(
      error,
      "google_unlink",
    );
  }
}
