import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import {
  getAuthedUser,
  recordAudit,
} from "@/lib/auth/guard";
import {
  decryptTotpSecret,
  verifyTotpCode,
} from "@/lib/auth/two-factor";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
) {
  const user = await getAuthedUser(req);

  if (!user) {
    return fail(
      "Bạn cần đăng nhập",
      401,
    );
  }

  if (!user.twoFactorEnabled) {
    return fail(
      "2FA hiện chưa được bật",
      400,
    );
  }

  try {
    const body = await req.json();

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

    const rows = await db
      .select({
        twoFactorSecret:
          users.twoFactorSecret,
      })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    const encryptedSecret =
      rows[0]?.twoFactorSecret;

    if (!encryptedSecret) {
      return fail(
        "Không tìm thấy cấu hình 2FA",
        400,
      );
    }

    const secret =
      decryptTotpSecret(
        encryptedSecret,
      );

    const valid = verifyTotpCode(
      secret,
      code,
    );

    if (!valid) {
      recordAudit(
        req,
        user.id,
        "2fa_disable_failed",
      );

      return fail(
        "Mã xác thực không đúng",
        401,
      );
    }

    await db
      .update(users)
      .set({
        twoFactorEnabled: false,
        twoFactorSecret: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    recordAudit(
      req,
      user.id,
      "2fa_disabled",
    );

    return ok({
      enabled: false,
      message:
        "Đã tắt xác thực hai lớp",
    });
  } catch (error) {
    console.error(
      "[2fa/disable]",
      error,
    );

    return fail(
      error instanceof Error
        ? error.message
        : "Không thể tắt 2FA",
      500,
    );
  }
}
