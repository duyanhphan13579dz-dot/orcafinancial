import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { fail, ok } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import {
  buildTotpUri,
  encryptTotpSecret,
  generateTotpSecret,
} from "@/lib/auth/two-factor";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
) {
  const user = await getAuthedUser(req);

  if (!user) {
    return fail(
      "Bạn cần đăng nhập để thiết lập 2FA",
      401,
    );
  }

  if (user.twoFactorEnabled) {
    return fail(
      "2FA đã được bật cho tài khoản này",
      400,
    );
  }

  try {
    const secret = generateTotpSecret();

    const encryptedSecret =
      encryptTotpSecret(secret);

    await db
      .update(users)
      .set({
        twoFactorSecret: encryptedSecret,
        twoFactorEnabled: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    const otpauthUri = buildTotpUri(
      secret,
      user.email,
    );

    const qrCodeDataUrl =
      await QRCode.toDataURL(
        otpauthUri,
        {
          width: 280,
          margin: 2,
          errorCorrectionLevel: "M",
        },
      );

    recordAudit(
      req,
      user.id,
      "2fa_setup_started",
    );

    return ok({
      secret,
      otpauthUri,
      qrCodeDataUrl,
    });
  } catch (error) {
    console.error(
      "[2fa/setup]",
      error,
    );

    return fail(
      error instanceof Error
        ? error.message
        : "Không thể khởi tạo 2FA",
      500,
    );
  }
}
