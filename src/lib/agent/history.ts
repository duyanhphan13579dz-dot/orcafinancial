import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentConversations, agentLogs } from "@/db/schema";
import { ensureAgentTables } from "@/db/ensure-agent-tables";

export type ConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
};

export type HistoryMessage = {
  id: number;
  role: "user" | "agent";
  text: string;
  model?: string;
  latencyMs?: number;
  createdAt: string;
};

function titleFromPrompt(prompt: string): string {
  const t = prompt.replace(/\s+/g, " ").trim();
  if (t.length <= 48) return t || "Cuộc trò chuyện mới";
  return `${t.slice(0, 45)}…`;
}

export async function listConversations(userId: string, limit = 40): Promise<ConversationSummary[]> {
  await ensureAgentTables().catch(() => undefined);

  const rows = await db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      createdAt: agentConversations.createdAt,
      updatedAt: agentConversations.updatedAt,
      messageCount: sql<number>`(
        SELECT COUNT(*)::int FROM agent_logs
        WHERE agent_logs.conversation_id = ${agentConversations.id}
      )`,
    })
    .from(agentConversations)
    .where(eq(agentConversations.userId, userId))
    .orderBy(desc(agentConversations.updatedAt))
    .limit(Math.min(100, Math.max(1, limit)));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    messageCount: Number(r.messageCount) || 0,
  }));
}

export async function getConversationMessages(
  userId: string,
  conversationId: string,
): Promise<{ conversation: ConversationSummary | null; messages: HistoryMessage[] }> {
  await ensureAgentTables().catch(() => undefined);

  const conv = await db
    .select()
    .from(agentConversations)
    .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.userId, userId)))
    .limit(1);

  if (!conv.length) {
    return { conversation: null, messages: [] };
  }

  const c = conv[0];
  const logs = await db
    .select()
    .from(agentLogs)
    .where(eq(agentLogs.conversationId, conversationId))
    .orderBy(agentLogs.createdAt)
    .limit(200);

  const messages: HistoryMessage[] = [];
  for (const log of logs) {
    messages.push({
      id: log.id * 2,
      role: "user",
      text: log.prompt,
      createdAt: log.createdAt.toISOString(),
    });
    messages.push({
      id: log.id * 2 + 1,
      role: "agent",
      text: log.response,
      model: log.model,
      latencyMs: log.latencyMs,
      createdAt: log.createdAt.toISOString(),
    });
  }

  return {
    conversation: {
      id: c.id,
      title: c.title,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messageCount: logs.length,
    },
    messages,
  };
}

export async function createConversation(userId: string, title?: string): Promise<string> {
  await ensureAgentTables().catch(() => undefined);

  const [row] = await db
    .insert(agentConversations)
    .values({
      userId,
      title: title?.trim() || "Cuộc trò chuyện mới",
    })
    .returning({ id: agentConversations.id });

  return row.id;
}

export async function appendChatTurn(opts: {
  userId: string | null;
  conversationId: string | null;
  sessionId: string;
  prompt: string;
  response: string;
  model: string;
  latencyMs: number;
}): Promise<{ conversationId: string | null }> {
  await ensureAgentTables().catch(() => undefined);

  let conversationId = opts.conversationId;

  if (opts.userId) {
    if (conversationId) {
      const owned = await db
        .select({ id: agentConversations.id })
        .from(agentConversations)
        .where(
          and(eq(agentConversations.id, conversationId), eq(agentConversations.userId, opts.userId)),
        )
        .limit(1);
      if (!owned.length) conversationId = null;
    }

    if (!conversationId) {
      conversationId = await createConversation(opts.userId, titleFromPrompt(opts.prompt));
    } else {
      await db
        .update(agentConversations)
        .set({
          updatedAt: new Date(),
          title: titleFromPrompt(opts.prompt),
        })
        .where(
          and(
            eq(agentConversations.id, conversationId),
            eq(agentConversations.userId, opts.userId),
            eq(agentConversations.title, "Cuộc trò chuyện mới"),
          ),
        )
        .catch(() => undefined);

      await db
        .update(agentConversations)
        .set({ updatedAt: new Date() })
        .where(eq(agentConversations.id, conversationId))
        .catch(() => undefined);
    }
  } else {
    conversationId = null;
  }

  await db.insert(agentLogs).values({
    sessionId: opts.sessionId,
    userId: opts.userId,
    conversationId,
    prompt: opts.prompt,
    response: opts.response.slice(0, 8000),
    model: opts.model,
    latencyMs: opts.latencyMs,
  });

  return { conversationId };
}

export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  await ensureAgentTables().catch(() => undefined);

  const deleted = await db
    .delete(agentConversations)
    .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.userId, userId)))
    .returning({ id: agentConversations.id });

  return deleted.length > 0;
}
