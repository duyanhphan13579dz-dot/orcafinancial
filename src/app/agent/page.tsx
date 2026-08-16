"use client";

import { useRef, useState, useEffect } from "react";
import { api } from "@/lib/client";
import { ProtectedPage } from "@/components/ProtectedPage";

interface Msg {
  role: "user" | "agent";
  text: string;
  model?: string;
  latencyMs?: number;
}

const SUGGESTIONS = ["Phân tích VNM", "HPG có nên mua không?", "Tổng quan thị trường hôm nay", "So sánh FPT và MWG"];

export default function AgentPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setMessages((m) => [...m, { role: "user", text: message }]);
    setInput("");
    setBusy(true);
    try {
      const env = await api<{ answer: string; model: string }>("/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: env.data.answer,
          model: env.data.model,
          latencyMs: typeof env.meta?.latencyMs === "number" ? env.meta.latencyMs : undefined,
        },
      ]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "agent", text: `⚠️ ${err instanceof Error ? err.message : "Lỗi không xác định"}` },
      ]);
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  return (
    <ProtectedPage featureName="AI Agent">
      <div className="flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-180px)] max-w-none md:max-w-3xl mx-auto">
        {/* Header */}
        <div className="flex-shrink-0 mb-3">
          <h1 className="text-lg md:text-xl font-bold">AI Agent — Chuyên viên phân tích</h1>
          <p className="text-xs text-slate-500 mt-1">
            Agent truy vấn dữ liệu thật qua Data Engine — không bao giờ bịa số liệu.
          </p>
        </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-hide mb-3">
        {messages.length === 0 ? (
          <div className="text-center py-8 md:py-10">
            <div className="text-slate-500 text-sm mb-4">Hỏi về một mã cổ phiếu hoặc thị trường:</div>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="rounded-full border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-[#00d4ff] hover:text-[#00d4ff] active:scale-95 transition-all touch-min"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] md:max-w-[75%] rounded-2xl px-4 py-3 text-sm ${
                    m.role === "user"
                      ? "bg-[#00d4ff] text-[#0A2540] rounded-br-sm"
                      : "bg-[#0e2e4f] border border-[#1a3558] text-slate-200 rounded-bl-sm"
                  }`}
                >
                  <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                  {m.latencyMs && (
                    <div className="text-[10px] opacity-60 mt-2 font-mono">{m.latencyMs}ms · {m.model}</div>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 flex gap-2 items-end">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Nhập câu hỏi..."
          rows={1}
          className="flex-1 bg-[#0e2e4f] border border-[#1a3558] rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-[#00d4ff] focus:outline-none resize-none min-h-[44px] max-h-32"
          style={{ height: "auto" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "auto";
            target.style.height = Math.min(target.scrollHeight, 128) + "px";
          }}
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="h-11 w-11 md:h-12 md:w-12 flex items-center justify-center rounded-xl bg-[#00d4ff] text-[#0A2540] font-bold disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-transform touch-min"
        >
          {busy ? (
            <span className="h-5 w-5 border-2 border-[#0A2540] border-t-transparent rounded-full animate-spin" />
          ) : (
            "➤"
          )}
        </button>
      </form>
      </div>
    </ProtectedPage>
  );
}
