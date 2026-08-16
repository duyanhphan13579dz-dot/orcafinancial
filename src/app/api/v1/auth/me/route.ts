import { NextRequest } from "next/server";
import { checkRateLimit, fail, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/auth/me — current user.
 *
 * Resolves the session from EITHER:
 *   1. `Authorization: Bearer <access-token>` (API clients), or
 *   2. the `refreshToken` httpOnly cookie (browser navigation).
 *
 * The cookie path is essential: the browser never stores the short-lived
 * access token, so without cookie support this endpoint always returned 401
 * and the client-side AuthProvider could never see a logged-in user.
 */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 240);
  if (limited) return limited;

  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  return ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      phoneNumber: user.phoneNumber,
      provider: user.provider,
      emailVerified: user.emailVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    },
  });
}
