import { NextRequest } from "next/server";
import { checkRateLimit, fail, handleError } from "@/lib/api";
import { getAuthedUser, recordAudit } from "@/lib/auth/guard";
import { exportUserData } from "@/lib/settings/service";

export const dynamic = "force-dynamic";

/**
 * POST /api/v1/users/export-data
 * Returns a downloadable JSON snapshot of everything we store about the user.
 */
export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, 5);
  if (limited) return limited;
  const user = await getAuthedUser(req);
  if (!user) return fail("Chưa đăng nhập", 401);

  try {
    const data = await exportUserData(user.id);
    recordAudit(req, user.id, "export_data");

    const filename = `orca-data-${user.email.replace(/[^a-z0-9]/gi, "_")}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    return new Response(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return handleError(err, "export_data");
  }
}
