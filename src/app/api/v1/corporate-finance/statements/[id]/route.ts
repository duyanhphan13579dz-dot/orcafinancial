import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { deleteCorporateStatement } from "@/lib/corporate-finance/service";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/corporate-finance/statements/:id */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const { id } = await params;
    const deleted = await deleteCorporateStatement(user.id, id);
    if (!deleted) return fail("Không tìm thấy bản ghi", 404);
    recordAudit(req, user.id, "delete_corporate_finance_statement", { id });
    return ok({ deleted: true });
  } catch (err) {
    return handleError(err, "corporate_finance_statement_delete");
  }
}
