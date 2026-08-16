/**
 * Settings service — preferences, sessions, audit log, data export.
 *
 * All functions are defensive: preferences are lazily created with defaults on
 * first read so the UI never has to handle a "no row yet" state.
 */

import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  userPreferences,
  userSessions,
  auditLogs,
  refreshTokens,
  watchlistItems,
} from "@/db/schema";
import { safeDbQuery } from "@/lib/connectors/core";

export type Preferences = typeof userPreferences.$inferSelect;

const DEFAULT_PREFS = {
  theme: "dark",
  accentColor: "#00d4ff",
  language: "vi",
  fontScale: "md",
  dashboardLayout: null,
  emailMorning: true,
  morningTime: "07:30",
  emailSummary: true,
  summaryTime: "15:15",
  emailAlerts: false,
  emailNews: false,
  pushEnabled: false,
  inAppNotifications: true,
} as const;

export const ACCENT_COLORS = [
  { id: "cyan", label: "Xanh ngọc", value: "#00d4ff" },
  { id: "navy", label: "Xanh dương đậm", value: "#3b82f6" },
  { id: "emerald", label: "Xanh lá", value: "#10b981" },
  { id: "violet", label: "Tím", value: "#8b5cf6" },
  { id: "amber", label: "Hổ phách", value: "#f59e0b" },
  { id: "rose", label: "Đỏ", value: "#f43f5e" },
];

/** Read preferences, creating the row with defaults if absent. */
export async function getPreferences(userId: string): Promise<Preferences> {
  const rows = await safeDbQuery("prefs_read", () =>
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
  );
  if (rows.length) return rows[0];

  const inserted = await safeDbQuery("prefs_create", () =>
    db
      .insert(userPreferences)
      .values({ userId, ...DEFAULT_PREFS })
      .onConflictDoNothing()
      .returning(),
  );
  if (inserted.length) return inserted[0];

  const again = await safeDbQuery("prefs_reread", () =>
    db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1),
  );
  return again[0];
}

export async function updatePreferences(
  userId: string,
  patch: Partial<Omit<Preferences, "userId" | "updatedAt">>,
): Promise<Preferences> {
  await getPreferences(userId); // ensure row exists
  const rows = await safeDbQuery("prefs_update", () =>
    db
      .update(userPreferences)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId))
      .returning(),
  );
  return rows[0];
}

/* ─────────────────────────── Sessions ─────────────────────────── */

export interface SessionView {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  browser: string;
  os: string;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  current: boolean;
}

function parseUA(ua: string | null): { browser: string; os: string } {
  if (!ua) return { browser: "Không rõ", os: "Không rõ" };
  const browser = /Edg\//i.test(ua)
    ? "Edge"
    : /OPR\/|Opera/i.test(ua)
      ? "Opera"
      : /Chrome\//i.test(ua)
        ? "Chrome"
        : /Safari\//i.test(ua)
          ? "Safari"
          : /Firefox\//i.test(ua)
            ? "Firefox"
            : "Khác";
  const os = /Windows NT/i.test(ua)
    ? "Windows"
    : /Mac OS X/i.test(ua)
      ? "macOS"
      : /Android/i.test(ua)
        ? "Android"
        : /iPhone|iPad|iOS/i.test(ua)
          ? "iOS"
          : /Linux/i.test(ua)
            ? "Linux"
            : "Khác";
  return { browser, os };
}

export async function listSessions(userId: string, currentToken?: string): Promise<SessionView[]> {
  const rows = await safeDbQuery("sessions_list", () =>
    db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(desc(userSessions.lastActiveAt))
      .limit(50),
  ).catch(() => []);

  return rows.map((r) => {
    const { browser, os } = parseUA(r.userAgent);
    return {
      id: r.id,
      userAgent: r.userAgent,
      ipAddress: r.ipAddress,
      browser,
      os,
      createdAt: r.createdAt,
      lastActiveAt: r.lastActiveAt,
      expiresAt: r.expiresAt,
      current: !!currentToken && r.token === currentToken,
    };
  });
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const rows = await safeDbQuery("session_revoke", () =>
    db
      .delete(userSessions)
      .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)))
      .returning({ token: userSessions.token }),
  ).catch(() => []);
  if (!rows.length) return false;
  // Also invalidate the paired refresh token so the device is truly logged out.
  await db.delete(refreshTokens).where(eq(refreshTokens.token, rows[0].token)).catch(() => undefined);
  return true;
}

export async function revokeOtherSessions(userId: string, currentToken?: string): Promise<number> {
  const rows = await safeDbQuery("sessions_revoke_others", () =>
    currentToken
      ? db
          .delete(userSessions)
          .where(and(eq(userSessions.userId, userId), ne(userSessions.token, currentToken)))
          .returning({ token: userSessions.token })
      : db.delete(userSessions).where(eq(userSessions.userId, userId)).returning({ token: userSessions.token }),
  ).catch(() => []);

  for (const r of rows) {
    await db.delete(refreshTokens).where(eq(refreshTokens.token, r.token)).catch(() => undefined);
  }
  return rows.length;
}

/** Register (or refresh) a session row for a refresh token. */
export async function upsertSession(opts: {
  userId: string;
  token: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
}): Promise<void> {
  await db
    .insert(userSessions)
    .values({
      userId: opts.userId,
      token: opts.token,
      userAgent: opts.userAgent?.slice(0, 400) ?? null,
      ipAddress: opts.ipAddress,
      expiresAt: opts.expiresAt,
      lastActiveAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userSessions.token,
      set: { lastActiveAt: new Date(), expiresAt: opts.expiresAt },
    })
    .catch(() => undefined);
}

/* ─────────────────────────── Audit log ─────────────────────────── */

export async function listAuditLogs(userId: string, limit = 50) {
  return safeDbQuery("audit_list", () =>
    db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.userId, userId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit),
  ).catch(() => []);
}

/* ─────────────────────────── Data export ─────────────────────────── */

export async function exportUserData(userId: string) {
  const [userRows, prefs, sessions, logs, watchlist] = await Promise.all([
    db.select().from(users).where(eq(users.id, userId)).limit(1).catch(() => []),
    getPreferences(userId).catch(() => null),
    listSessions(userId).catch(() => []),
    listAuditLogs(userId, 500).catch(() => []),
    db.select().from(watchlistItems).catch(() => []),
  ]);

  const u = userRows[0];
  return {
    exportedAt: new Date().toISOString(),
    account: u
      ? {
          id: u.id,
          email: u.email,
          name: u.name,
          avatarUrl: u.avatarUrl,
          phoneNumber: u.phoneNumber,
          provider: u.provider,
          emailVerified: u.emailVerified,
          twoFactorEnabled: u.twoFactorEnabled,
          createdAt: u.createdAt,
        }
      : null,
    preferences: prefs,
    sessions: sessions.map((s) => ({
      browser: s.browser,
      os: s.os,
      ipAddress: s.ipAddress,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
    })),
    auditLogs: logs,
    watchlist,
  };
}

export async function deleteAccount(userId: string): Promise<void> {
  // Cascades remove preferences, sessions, refresh tokens and audit logs.
  await db.delete(users).where(eq(users.id, userId));
}
