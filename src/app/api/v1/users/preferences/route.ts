import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError, ok } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { ACCENT_COLORS, getPreferences, updatePreferences } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

const THEMES = new Set(["light", "dark", "system"]);
const LANGS = new Set(["vi", "en"]);
const SCALES = new Set(["sm", "md", "lg"]);
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** GET /api/v1/users/preferences */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const prefs = await getPreferences(user.id);
    return ok({ preferences: prefs, accentColors: ACCENT_COLORS });
  } catch (err) {
    return handleError(err, "prefs_get");
  }
}

/** PUT /api/v1/users/preferences */
export async function PUT(req: NextRequest) {
  const limited = checkRateLimit(req, 60);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (body.theme !== undefined) {
      if (typeof body.theme !== "string" || !THEMES.has(body.theme)) return fail("Theme không hợp lệ", 400);
      patch.theme = body.theme;
    }
    if (body.accentColor !== undefined) {
      if (typeof body.accentColor !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.accentColor)) {
        return fail("Mã màu không hợp lệ", 400);
      }
      patch.accentColor = body.accentColor;
    }
    if (body.language !== undefined) {
      if (typeof body.language !== "string" || !LANGS.has(body.language)) return fail("Ngôn ngữ không hợp lệ", 400);
      patch.language = body.language;
    }
    if (body.fontScale !== undefined) {
      if (typeof body.fontScale !== "string" || !SCALES.has(body.fontScale)) return fail("Cỡ chữ không hợp lệ", 400);
      patch.fontScale = body.fontScale;
    }
    if (body.dashboardLayout !== undefined) {
      patch.dashboardLayout = body.dashboardLayout as Record<string, unknown> | null;
    }

    for (const key of ["emailMorning", "emailSummary", "emailAlerts", "emailNews", "pushEnabled", "inAppNotifications"]) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== "boolean") return fail(`${key} phải là true/false`, 400);
        patch[key] = body[key];
      }
    }

    for (const key of ["morningTime", "summaryTime"]) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== "string" || !TIME_RE.test(body[key] as string)) {
          return fail(`${key} phải theo định dạng HH:MM`, 400);
        }
        patch[key] = body[key];
      }
    }

    if (Object.keys(patch).length === 0) return fail("Không có thay đổi nào", 400);

    const prefs = await updatePreferences(user.id, patch);
    recordAudit(req, user.id, "update_preferences", { fields: Object.keys(patch) });
    return ok({ preferences: prefs });
  } catch (err) {
    return handleError(err, "prefs_put");
  }
}
