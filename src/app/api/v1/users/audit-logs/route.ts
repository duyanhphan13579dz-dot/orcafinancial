import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { listAuditLogs } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/users/audit-logs?limit=50 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const raw = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const limit = Math.min(200, Math.max(1, Number.isFinite(raw) ? raw : 50));
    const logs = await listAuditLogs(user.id, limit);
    return ok({ logs, count: logs.length });
  } catch (err) {
    return handleError(err, "audit_logs");
  }
}
