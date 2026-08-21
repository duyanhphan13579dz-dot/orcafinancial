import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { listCorporateStatements, upsertCorporateStatement, validateCorporateStatement } from "@/lib/corporate-finance/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/corporate-finance/statements?company=... — danh sách BCTC của người dùng (lọc theo công ty nếu có). */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const company = req.nextUrl.searchParams.get("company") ?? undefined;
    const statements = await listCorporateStatements(user.id, company);
    return ok({ statements });
  } catch (err) {
    return handleError(err, "corporate_finance_statements_get");
  }
}

/**
 * POST /api/v1/corporate-finance/statements — tạo mới hoặc cập nhật (upsert) một kỳ BCTC.
 * Khóa duy nhất: companyName + fiscalYear + period.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const { input, error } = validateCorporateStatement(body);
    if (error || !input) return fail(error ?? "Dữ liệu không hợp lệ", 400);

    const statement = await upsertCorporateStatement(user.id, input);
    recordAudit(req, user.id, "upsert_corporate_finance_statement", {
      companyName: statement.companyName,
      fiscalYear: statement.fiscalYear,
      period: statement.period,
    });
    return ok({ statement });
  } catch (err) {
    return handleError(err, "corporate_finance_statements_post");
  }
}
