import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { listSessions, revokeOtherSessions } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

/** GET /api/v1/users/sessions — list active login sessions */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const currentToken = req.cookies.get("refreshToken")?.value;
    const sessions = await listSessions(user.id, currentToken);
    return ok({ sessions, count: sessions.length });
  } catch (err) {
    return handleError(err, "sessions_list");
  }
}

/** DELETE /api/v1/users/sessions — revoke every session except the current one */
export async function DELETE(req: NextRequest) {
  const limited = checkRateLimit(req, 20);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const currentToken = req.cookies.get("refreshToken")?.value;
    const revoked = await revokeOtherSessions(user.id, currentToken);
    recordAudit(req, user.id, "revoke_other_sessions", { revoked });
    return ok({ revoked });
  } catch (err) {
    return handleError(err, "sessions_revoke_all");
  }
}
