"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, timeAgo } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";
import { useAuth } from "@/lib/auth/context";

interface Msg {
  id?: number | string;
  role: "user" | "agent";
  text: string;
  model?: string;
  latencyMs?: number;
}

interface ConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

const SUGGESTIONS = [
  "Phân tích VNM",
  "Tổng quan thị trường hôm nay",
  "Lập ngân sách cá nhân thế nào?",
  "Phân bổ tài sản theo khẩu vị rủi ro",
  "Doanh nghiệp nên quản lý vốn lưu động ra sao?",
  "So sánh FPT và MWG",
];

export default function AgentPage() {
  return (
    <ProtectedPage featureName="trợ lý AI">
      <AgentChatShell />
    </ProtectedPage>
  );
}

function AgentChatShell() {
  const { isLoggedIn } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, busy, scrollToBottom]);

  const loadConversations = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const env = await api<{ items: ConversationSummary[] }>("/agent/conversations?limit=50", {
        skipCache: true,
      });
      setConversations(env.data.items ?? []);
    } catch (err) {
      console.warn("[agent] loadConversations failed", err);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openConversation = async (id: string) => {
    if (busy) return;
    setHistoryLoading(true);
    setSidebarOpen(false);
    try {
      const env = await api<{
        conversation: ConversationSummary;
        messages: Array<{
          id: number;
          role: "user" | "agent";
          text: string;
          model?: string;
          latencyMs?: number;
        }>;
      }>(`/agent/conversations/${id}`, { skipCache: true });
      setConversationId(id);
      setMessages(
        (env.data.messages ?? []).map((m) => ({
          id: m.id,
          role: m.role,
          text: m.text,
          model: m.model,
          latencyMs: m.latencyMs,
        })),
      );
      scrollToBottom(false);
    } catch (err) {
      setMessages([
        {
          role: "agent",
          text: `⚠️ Không tải được lịch sử: ${err instanceof Error ? err.message : "lỗi không xác định"}`,
        },
      ]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Xóa cuộc trò chuyện này?")) return;
    try {
      await api(`/agent/conversations/${id}`, { method: "DELETE" });
      if (conversationId === id) startNewChat();
      setConversations((list) => list.filter((c) => c.id !== id));
    } catch {
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const env = await api<{
        answer: string;
        model: string;
        conversationId?: string | null;
        historySaved?: boolean;
        historyError?: string | null;
      }>("/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          conversationId: conversationId ?? undefined,
        }),
      });

      const cid = env.data.conversationId ?? null;
      if (cid) setConversationId(cid);

      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: env.data.answer,
          model: env.data.model,
          latencyMs:
            typeof env.meta?.latencyMs === "number" ? env.meta.latencyMs : undefined,
        },
      ]);

      await loadConversations();

      if (env.data.historySaved === false) {
        setMessages((m) => [
          ...m,
          {
            role: "agent",
            text: `⚠️ Trả lời OK nhưng chưa lưu lịch sử: ${env.data.historyError ?? "lỗi DB"}. Thử hỏi lại sau vài giây.`,
          },
        ]);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: `⚠️ ${err instanceof Error ? err.message : "Lỗi không xác định"}`,
        },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const HistoryList = (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 px-3 py-3 border-b border-[#1a3558] shrink-0">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Lịch sử chat
        </span>
        <button
          type="button"
          onClick={startNewChat}
          className="text-xs font-semibold rounded-lg px-2.5 py-1.5 bg-[#00d4ff]/15 text-[#00d4ff] border border-[#00d4ff]/30 hover:bg-[#00d4ff]/25 active:scale-95 transition-all min-h-[36px]"
        >
          + Mới
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-2 space-y-1">
        {conversations.length === 0 && (
          <div className="text-center text-xs text-slate-500 py-8 px-3">
            Chưa có cuộc trò chuyện nào. Hỏi agent để bắt đầu — lịch sử sẽ lưu trên tài khoản của bạn.
          </div>
        )}
        {conversations.map((c) => {
          const active = c.id === conversationId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => void openConversation(c.id)}
              className={`w-full text-left rounded-lg px-3 py-2.5 group transition-colors min-h-[48px] ${
                active
                  ? "bg-[#00d4ff]/15 border border-[#00d4ff]/35 text-white"
                  : "border border-transparent hover:bg-[#0e2e4f] text-slate-300"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{c.title}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {timeAgo(c.updatedAt)}
                    {c.messageCount > 0 ? ` · ${c.messageCount} lượt` : ""}
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => void deleteConversation(c.id, e)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void deleteConversation(c.id, e as unknown as React.MouseEvent);
                  }}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-rose-400 text-xs px-1.5 py-0.5 shrink-0"
                  title="Xóa"
                  aria-label="Xóa cuộc trò chuyện"
                >
                  ✕
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col lg:flex-row gap-0 lg:gap-4 -mx-3 sm:-mx-4 lg:mx-0 h-[calc(100dvh-7.5rem)] sm:h-[calc(100dvh-8.5rem)] lg:h-[calc(100dvh-11rem)] min-h-[420px]">
      <aside className="hidden md:flex md:w-64 lg:w-72 shrink-0 flex-col panel overflow-hidden">
        {HistoryList}
      </aside>

      {sidebarOpen && (
        <>
          <button
            type="button"
            className="md:hidden fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
            aria-label="Đóng lịch sử"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="md:hidden fixed inset-y-0 left-0 z-[70] w-[min(100vw,300px)] bg-[#0A2540] border-r border-[#1a3558] shadow-2xl flex flex-col safe-area-pt safe-area-pb">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-[#1a3558]">
              <span className="font-display font-bold text-sm text-white">Lịch sử</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="h-10 w-10 rounded-lg border border-[#1a3558] flex items-center justify-center text-slate-300"
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 min-h-0">{HistoryList}</div>
          </div>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col panel overflow-hidden">
        <div className="shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 border-b border-[#1a3558]">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="md:hidden h-10 w-10 rounded-lg border border-[#1a3558] bg-[#0e2e4f] flex items-center justify-center text-slate-300 active:scale-95 touch-min"
            aria-label="Mở lịch sử chat"
          >
            ☰
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm sm:text-base md:text-lg font-bold text-white truncate">
              Trợ lý AI ORCA
            </h1>
            <p className="text-[10px] sm:text-xs text-slate-500 truncate hidden xs:block sm:block">
              Thị trường · Tài chính cá nhân · Doanh nghiệp · Tài sản
            </p>
          </div>
          <button
            type="button"
            onClick={startNewChat}
            className="shrink-0 rounded-lg border border-[#1a3558] px-2.5 py-2 text-xs text-slate-300 hover:border-[#00d4ff] hover:text-[#00d4ff] active:scale-95 min-h-[40px]"
          >
            Chat mới
          </button>
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3 sm:py-4 scrollbar-hide"
        >
          {historyLoading ? (
            <div className="flex items-center justify-center h-full text-slate-500 text-sm gap-2">
              <span className="h-5 w-5 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
              Đang tải lịch sử…
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-full py-6 sm:py-10 text-center px-2">
              <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-br from-[#00d4ff]/20 to-[#0073a8]/20 border border-[#00d4ff]/25 flex items-center justify-center text-2xl sm:text-3xl mb-4">
                🤖
              </div>
              <div className="text-slate-300 text-sm sm:text-base font-medium mb-1">
                Cố vấn tài chính đa nhiệm
              </div>
              <div className="text-slate-500 text-xs sm:text-sm mb-5 max-w-md">
                Hỏi về mã CK, thị trường, ngân sách, doanh nghiệp hoặc phân bổ tài sản. Câu trả lời dựa trên dữ liệu thật.
              </div>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    disabled={busy}
                    className="rounded-full border border-[#1a3558] bg-[#0e2e4f]/60 px-3 py-2 text-[11px] sm:text-xs text-slate-300 hover:border-[#00d4ff] hover:text-[#00d4ff] active:scale-95 transition-all disabled:opacity-50 min-h-[40px]"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3 sm:space-y-4 max-w-3xl mx-auto">
              {messages.map((m, i) => (
                <div
                  key={m.id ?? i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[92%] sm:max-w-[85%] md:max-w-[75%] rounded-2xl px-3.5 sm:px-4 py-2.5 sm:py-3 text-[13px] sm:text-sm ${
                      m.role === "user"
                        ? "bg-[#00d4ff] text-[#0A2540] rounded-br-md"
                        : "bg-[#0e2e4f] border border-[#1a3558] text-slate-200 rounded-bl-md"
                    }`}
                  >
                    <div className="whitespace-pre-wrap leading-relaxed break-words">{m.text}</div>
                    {m.role === "agent" && (m.latencyMs || m.model) && (
                      <div className="text-[10px] opacity-60 mt-2 font-mono">
                        {[m.latencyMs ? `${m.latencyMs}ms` : null, m.model].filter(Boolean).join(" · ")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md px-4 py-3 bg-[#0e2e4f] border border-[#1a3558] text-slate-400 text-sm flex items-center gap-2">
                    <span className="h-4 w-4 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
                    Đang phân tích…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-[#1a3558] p-2.5 sm:p-3 safe-area-pb"
        >
          <div className="max-w-3xl mx-auto flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Hỏi về mã, thị trường, ngân sách, DN…"
              rows={1}
              className="flex-1 min-w-0 bg-[#0e2e4f] border border-[#1a3558] rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 text-sm text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none resize-none min-h-[44px] max-h-32 leading-snug"
              style={{ height: "auto" }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = "auto";
                target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
              }}
              disabled={busy}
              enterKeyHint="send"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="h-11 w-11 sm:h-12 sm:w-12 shrink-0 flex items-center justify-center rounded-xl bg-[#00d4ff] text-[#0A2540] font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform touch-min"
              aria-label="Gửi"
            >
              {busy ? (
                <span className="h-5 w-5 border-2 border-[#0A2540] border-t-transparent rounded-full animate-spin" />
              ) : (
                "➤"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
