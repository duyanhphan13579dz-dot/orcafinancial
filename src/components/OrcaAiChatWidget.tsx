"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, timeAgo } from "@/lib/client";
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
  "Tổng quan thị trường",
  "Lập ngân sách cá nhân",
  "So sánh FPT và MWG",
];

export function OrcaAiChatWidget() {
  const { isLoggedIn } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
    });
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, scrollToBottom]);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, busy, isOpen, scrollToBottom]);

  const loadConversations = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const env = await api<{ items: ConversationSummary[] }>("/agent/conversations?limit=20", {
        skipCache: true,
      });
      setConversations(env.data.items ?? []);
    } catch {
      // Graceful fallback
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (isOpen) {
      void loadConversations();
    }
  }, [isOpen, loadConversations]);

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setInput("");
    setShowHistory(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const openConversation = async (id: string) => {
    if (busy) return;
    setHistoryLoading(true);
    setShowHistory(false);
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
      // Ignore
    }
  };

  const send = async (textToSend: string) => {
    const message = textToSend.trim();
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
          latencyMs: typeof env.meta?.latencyMs === "number" ? env.meta.latencyMs : undefined,
        },
      ]);

      void loadConversations();
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

  return (
    <>
      {/* Floating Chat Trigger Bubble */}
      <div className="fixed bottom-20 lg:bottom-6 right-4 lg:right-6 z-[60] flex items-center gap-2">
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="group relative flex items-center gap-2 rounded-full bg-gradient-to-r from-[#00d4ff] to-[#0073a8] p-3 lg:px-4 lg:py-3 text-[#0A2540] font-bold shadow-[0_0_20px_rgba(0,212,255,0.4)] hover:shadow-[0_0_30px_rgba(0,212,255,0.7)] active:scale-95 transition-all"
            aria-label="Mở ORCA AI Chat"
          >
            <span className="text-xl leading-none">🤖</span>
            <span className="hidden lg:inline text-xs font-extrabold tracking-wide uppercase">
              ORCA AI
            </span>
            <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-emerald-400 border-2 border-[#0A2540] animate-pulse" />
          </button>
        )}
      </div>

      {/* Floating Window Panel */}
      {isOpen && (
        <div className="fixed bottom-20 lg:bottom-6 right-3 lg:right-6 z-[70] w-[min(calc(100vw-1.5rem),420px)] h-[min(calc(100vh-7rem),580px)] rounded-2xl bg-[#0A2540]/95 backdrop-blur-xl border border-[#00d4ff]/40 shadow-[0_16px_48px_rgba(0,0,0,0.7)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-3.5 py-2.5 bg-[#0e2e4f]/80 border-b border-[#1a3558]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-[#00d4ff] to-[#0073a8] flex items-center justify-center text-base shrink-0 font-extrabold text-[#0A2540]">
                🤖
              </div>
              <div className="min-w-0">
                <div className="font-display font-extrabold text-sm text-white flex items-center gap-1.5 leading-tight">
                  ORCA AI
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </div>
                <div className="text-[10px] text-cyan-300/80 truncate">
                  Cố vấn tài chính đa nhiệm
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className={`p-1.5 rounded-lg border text-xs transition-colors ${
                  showHistory
                    ? "bg-[#00d4ff]/20 border-[#00d4ff] text-[#00d4ff]"
                    : "border-[#1a3558] text-slate-400 hover:text-white"
                }`}
                title="Lịch sử chat"
              >
                📜
              </button>
              <button
                type="button"
                onClick={startNewChat}
                className="px-2 py-1 rounded-lg border border-[#1a3558] text-[11px] text-cyan-300 hover:bg-[#00d4ff]/10 hover:border-[#00d4ff] transition-colors"
                title="Tạo cuộc trò chuyện mới"
              >
                + Mới
              </button>
              <Link
                href="/agent"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg border border-[#1a3558] text-slate-400 hover:text-white text-xs transition-colors"
                title="Mở trang đầy đủ"
              >
                ↗
              </Link>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg border border-[#1a3558] text-slate-400 hover:text-rose-400 text-xs transition-colors"
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
          </div>

          {/* History Drawer Overlay */}
          {showHistory && (
            <div className="absolute inset-x-0 top-[49px] bottom-0 z-20 bg-[#0A2540] border-b border-[#1a3558] flex flex-col p-2 overflow-y-auto">
              <div className="flex items-center justify-between px-2 py-1.5 border-b border-[#1a3558] mb-2">
                <span className="text-xs font-semibold text-slate-300">Lịch sử trò chuyện</span>
                <button
                  type="button"
                  onClick={() => setShowHistory(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Đóng
                </button>
              </div>
              {conversations.length === 0 ? (
                <div className="text-center text-xs text-slate-500 py-6">
                  Chưa có lịch sử chat nào.
                </div>
              ) : (
                <div className="space-y-1">
                  {conversations.map((c) => (
                    <div
                      key={c.id}
                      onClick={() => void openConversation(c.id)}
                      className={`w-full text-left rounded-lg p-2 flex items-center justify-between text-xs cursor-pointer ${
                        c.id === conversationId
                          ? "bg-[#00d4ff]/20 text-white border border-[#00d4ff]/40"
                          : "bg-[#0e2e4f]/50 text-slate-300 hover:bg-[#0e2e4f]"
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="font-medium truncate">{c.title}</div>
                        <div className="text-[10px] text-slate-500">{timeAgo(c.updatedAt)}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => void deleteConversation(c.id, e)}
                        className="text-slate-500 hover:text-rose-400 p-1"
                        title="Xóa"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">
            {historyLoading ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-xs gap-2">
                <span className="h-4 w-4 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
                Đang tải…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center min-h-full py-4 text-center">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[#00d4ff]/20 to-[#0073a8]/20 border border-[#00d4ff]/30 flex items-center justify-center text-xl mb-2">
                  🤖
                </div>
                <div className="text-white text-xs font-semibold mb-1">Hỏi ORCA AI bất kỳ điều gì</div>
                <div className="text-slate-400 text-[11px] mb-3 max-w-xs leading-relaxed">
                  Phân tích cổ phiếu, xu hướng thị trường, ngân sách cá nhân hoặc tài chính doanh nghiệp.
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center max-w-xs">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      disabled={busy}
                      className="rounded-full border border-[#1a3558] bg-[#0e2e4f]/80 px-2.5 py-1 text-[11px] text-slate-300 hover:border-[#00d4ff] hover:text-[#00d4ff] active:scale-95 transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                {messages.map((m, i) => (
                  <div
                    key={m.id ?? i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                        m.role === "user"
                          ? "bg-[#00d4ff] text-[#0A2540] font-medium rounded-br-none"
                          : "bg-[#0e2e4f] border border-[#1a3558] text-slate-200 rounded-bl-none"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.text}</div>
                      {m.role === "agent" && (m.latencyMs || m.model) && (
                        <div className="text-[9px] opacity-60 mt-1 font-mono">
                          {[m.latencyMs ? `${m.latencyMs}ms` : null, m.model].filter(Boolean).join(" · ")}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-none px-3 py-2 bg-[#0e2e4f] border border-[#1a3558] text-slate-400 text-xs flex items-center gap-1.5">
                      <span className="h-3.5 w-3.5 border-2 border-[#00d4ff] border-t-transparent rounded-full animate-spin" />
                      Đang phân tích…
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Footer Form Input */}
          <form
            onSubmit={handleSubmit}
            className="shrink-0 border-t border-[#1a3558] p-2 bg-[#081d35]"
          >
            <div className="flex gap-1.5 items-end">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Hỏi ORCA AI…"
                rows={1}
                className="flex-1 min-w-0 bg-[#0e2e4f] border border-[#1a3558] rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none resize-none min-h-[38px] max-h-24 leading-snug"
                disabled={busy}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xl bg-[#00d4ff] text-[#0A2540] font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-transform"
                aria-label="Gửi"
              >
                {busy ? (
                  <span className="h-3.5 w-3.5 border-2 border-[#0A2540] border-t-transparent rounded-full animate-spin" />
                ) : (
                  "➤"
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
