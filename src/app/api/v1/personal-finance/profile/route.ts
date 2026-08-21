import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import {
  getPersonalFinanceProfile,
  upsertPersonalFinanceProfile,
  validatePersonalFinancePatch,
} from "@/lib/personal-finance/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/personal-finance/profile — hồ sơ tài chính cá nhân của người dùng hiện tại. */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const profile = await getPersonalFinanceProfile(user.id);
    return ok({ profile });
  } catch (err) {
    return handleError(err, "personal_finance_profile_get");
  }
}

/** PUT /api/v1/personal-finance/profile — cập nhật (upsert) hồ sơ. Chỉ ghi đè field được gửi lên. */
export async function PUT(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const { patch, error } = validatePersonalFinancePatch(body);
    if (error) return fail(error, 400);
    if (Object.keys(patch).length === 0) return fail("Không có thay đổi nào", 400);

    const profile = await upsertPersonalFinanceProfile(user.id, patch);
    recordAudit(req, user.id, "update_personal_finance_profile", { fields: Object.keys(patch) });
    return ok({ profile });
  } catch (err) {
    return handleError(err, "personal_finance_profile_put");
  }
}
