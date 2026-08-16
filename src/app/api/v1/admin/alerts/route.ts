import { NextRequest } from "next/server";
import { checkRateLimit, handleError, ok } from "@/lib/api";
import { listAlertsFromDb, listOpenAlerts, listRecentAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, 120);
  if (limited) return limited;
  try {
    const url = new URL(req.url);
    const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "100", 10) || 100);
    const dbAlerts = await listAlertsFromDb(limit);
    return ok({
      open: listOpenAlerts(),
      recent: listRecentAlerts(limit),
      db: dbAlerts,
    });
  } catch (err) {
    return handleError(err, "admin_alerts");
  }
}
