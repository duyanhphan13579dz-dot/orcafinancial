import { NextRequest } from "next/server";
import { fail, handleError, ok } from "@/lib/api";
import { getAuthedUser } from "@/lib/auth/guard";
import { deleteConversation, getConversationMessages } from "@/lib/agent/history";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthedUser(req);
    if (!user) return fail("Unauthorized", 401);

    const { id } = await ctx.params;
    if (!id) return fail("Missing conversation id", 400);

    const result = await getConversationMessages(user.id, id);
    if (!result.conversation) return fail("Conversation not found", 404);

    return ok(result);
  } catch (err) {
    return handleError(err, "agent_conversation_get");
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthedUser(req);
    if (!user) return fail("Unauthorized", 401);

    const { id } = await ctx.params;
    if (!id) return fail("Missing conversation id", 400);

    const okDelete = await deleteConversation(user.id, id);
    if (!okDelete) return fail("Conversation not found", 404);

    return ok({ deleted: true });
  } catch (err) {
    return handleError(err, "agent_conversation_delete");
  }
}
