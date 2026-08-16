import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { revokeSession } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

/** DELETE /api/v1/users/sessions/:id — revoke one session (log out that device) */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const limited = checkRateLimit(req, 30);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Session id không hợp lệ", 400);

  try {
    const done = await revokeSession(user.id, id);
    if (!done) return fail("Không tìm thấy phiên đăng nhập", 404);
    recordAudit(req, user.id, "revoke_session", { sessionId: id });
    return ok({ revoked: true, sessionId: id });
  } catch (err) {
    return handleError(err, "session_revoke");
  }
}
