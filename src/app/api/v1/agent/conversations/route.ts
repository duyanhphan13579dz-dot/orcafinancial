import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { createConversation, listConversations } from "@/lib/agent/history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user) return fail("Unauthorized", 401);

    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "40");
    const items = await listConversations(user.id, limit);
    return ok({ items });
  } catch (err) {
    return handleError(err, "agent_conversations_list");
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthedUser(req);
    if (!user) return fail("Unauthorized", 401);

    const body = (await req.json().catch(() => ({}))) as { title?: string };
    const id = await createConversation(user.id, body.title);
    return ok({ id });
  } catch (err) {
    return handleError(err, "agent_conversations_create");
  }
}
