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

function newId(): string {
  return crypto.randomUUID();
}

export async function listConversations(userId: string, limit = 40): Promise<ConversationSummary[]> {
  await ensureAgentTables();

  const rows = await db
    .select({
      id: agentConversations.id,
      title: agentConversations.title,
      createdAt: agentConversations.createdAt,
      updatedAt: agentConversations.updatedAt,
      messageCount: sql<number>`coalesce((
        select count(*)::int from agent_logs al
        where al.conversation_id = agent_conversations.id
      ), 0)`,
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
  await ensureAgentTables();

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
  await ensureAgentTables();

  const id = newId();
  await db.insert(agentConversations).values({
    id,
    userId,
    title: title?.trim() || "Cuộc trò chuyện mới",
  });

  return id;
}

export async function appendChatTurn(opts: {
  userId: string | null;
  conversationId: string | null;
  sessionId: string;
  prompt: string;
  response: string;
  model: string;
  latencyMs: number;
}): Promise<{ conversationId: string | null; saved: boolean; error?: string }> {
  try {
    await ensureAgentTables();
  } catch (err) {
    return {
      conversationId: null,
      saved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let conversationId = opts.conversationId;

  if (!opts.userId) {
    // Guest: still log without conversation thread
    try {
      await db.insert(agentLogs).values({
        sessionId: opts.sessionId || "guest",
        userId: null,
        conversationId: null,
        prompt: opts.prompt,
        response: opts.response.slice(0, 8000),
        model: opts.model,
        latencyMs: opts.latencyMs,
      });
      return { conversationId: null, saved: true };
    } catch (err) {
      return {
        conversationId: null,
        saved: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  try {
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
        .set({ updatedAt: new Date() })
        .where(
          and(eq(agentConversations.id, conversationId), eq(agentConversations.userId, opts.userId)),
        );
    }

    await db.insert(agentLogs).values({
      sessionId: opts.sessionId || "auth",
      userId: opts.userId,
      conversationId,
      prompt: opts.prompt,
      response: opts.response.slice(0, 8000),
      model: opts.model,
      latencyMs: opts.latencyMs,
    });

    return { conversationId, saved: true };
  } catch (err) {
    return {
      conversationId: conversationId ?? null,
      saved: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function deleteConversation(userId: string, conversationId: string): Promise<boolean> {
  await ensureAgentTables();

  // Logs cascade via FK; if cascade missing, delete logs first
  await db.delete(agentLogs).where(eq(agentLogs.conversationId, conversationId)).catch(() => undefined);

  const deleted = await db
    .delete(agentConversations)
    .where(and(eq(agentConversations.id, conversationId), eq(agentConversations.userId, userId)))
    .returning({ id: agentConversations.id });

  return deleted.length > 0;
}
