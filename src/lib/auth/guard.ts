/**
 * Server-side auth guard for API routes.
 *
 * Resolves the current user from either:
 *   1. `Authorization: Bearer <access-token>` header, or
 *   2. the `refreshToken` httpOnly cookie (looked up in `refresh_tokens`).
 *
 * The cookie path is what the browser uses for normal navigation, so Settings
 * pages work without the client having to manually attach a bearer token.
 *
 * Never throws — returns `null` when unauthenticated so route handlers can
 * decide the response shape themselves.
 */

import type { NextRequest } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { users, refreshTokens, auditLogs } from "@/db/schema";
import { verifyAccessToken } from "@/lib/auth/service";
import { safeDbQuery } from "@/lib/connectors/core";

export interface AuthedUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  phoneNumber: string | null;
  provider: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: Date;
}

export async function getAuthedUser(req: NextRequest): Promise<AuthedUser | null> {
  // ── 1. Bearer token ──
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const payload = await verifyAccessToken(authHeader.slice(7));
    if (payload?.userId) {
      const rows = await safeDbQuery("guard_user_by_id", () =>
        db
          .select({
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
            phoneNumber: users.phoneNumber,
            provider: users.provider,
            emailVerified: users.emailVerified,
            twoFactorEnabled: users.twoFactorEnabled,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(eq(users.id, payload.userId))
          .limit(1),
      ).catch(() => []);
      if (rows.length) return toAuthedUser(rows[0]);
    }
  }

  // ── 2. Refresh-token cookie ──
  const cookieToken = req.cookies.get("refreshToken")?.value;
  if (cookieToken) {
    const rows = await safeDbQuery("guard_user_by_refresh", () =>
      db
        .select({
          user: {
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
            phoneNumber: users.phoneNumber,
            provider: users.provider,
            emailVerified: users.emailVerified,
            twoFactorEnabled: users.twoFactorEnabled,
            createdAt: users.createdAt,
          },
        })
        .from(refreshTokens)
        .innerJoin(users, eq(users.id, refreshTokens.userId))
        .where(and(eq(refreshTokens.token, cookieToken), gt(refreshTokens.expiresAt, new Date())))
        .limit(1),
    ).catch(() => []);
    if (rows.length) return toAuthedUser(rows[0].user);
  }

  return null;
}

type AuthUserRow = Pick<
  typeof users.$inferSelect,
  | "id"
  | "email"
  | "name"
  | "avatarUrl"
  | "phoneNumber"
  | "provider"
  | "emailVerified"
  | "twoFactorEnabled"
  | "createdAt"
>;

function toAuthedUser(u: AuthUserRow): AuthedUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    phoneNumber: u.phoneNumber,
    provider: u.provider,
    emailVerified: u.emailVerified,
    twoFactorEnabled: u.twoFactorEnabled,
    createdAt: u.createdAt,
  };
}

/** Fire-and-forget audit trail entry. Never throws. */
export function recordAudit(
  req: NextRequest,
  userId: string,
  action: string,
  metadata?: Record<string, unknown>,
): void {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    null;
  void db
    .insert(auditLogs)
    .values({
      userId,
      action,
      metadata: metadata ?? null,
      ipAddress: ip,
      userAgent: req.headers.get("user-agent")?.slice(0, 400) ?? null,
    })
    .catch(() => undefined);
}
