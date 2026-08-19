import { NextRequest } from "next/server";
import { checkRateLimit, ok } from "@/lib/api";
import { db } from "@/db";
import { refreshTokens, userSessions } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/auth/logout
 * Invalidate refresh token
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;

  try {
    const refreshToken = req.cookies.get("refreshToken")?.value;

    if (refreshToken) {
      // Delete refresh token + its session row from DB
      await db.delete(refreshTokens).where(eq(refreshTokens.token, refreshToken));
      await db.delete(userSessions).where(eq(userSessions.token, refreshToken)).catch(() => undefined);
    }

    const response = ok({ success: true });
    response.cookies.delete("refreshToken");
    
    response.cookies.delete(
  "orca_2fa_challenge",
);

    return response;
  } catch (err) {
    return ok({ success: false, error: err instanceof Error ? err.message : "Logout failed" });
  }
}
