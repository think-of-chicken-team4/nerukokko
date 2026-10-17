"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { createClient } from "@/lib/supabase/client";

export type ChatMessage = { id: string; role: "user" | "assistant"; text: string };

type ChatResponse = { chat_session_id: string; reply: string; fallback: boolean };

const GREETING = "こんにちはコケ！眠りのことでも、今日あったことでも、なんでも話しかけてほしいコケ。";
const MAX_LENGTH = 500;

// にわとりとのチャット（T-110）。送ると自分の発言をすぐ出し、chat（Edge Function）の返事を待って出す
export function ChatPanel({ initialSessionId, initialMessages }: { initialSessionId: string | null; initialMessages: ChatMessage[] }) {
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);

  // 新しい発言が増えたら、いちばん下まで送る
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  const send = () => {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    setError(undefined);
    setMessages((current) => [...current, { id: `local-${Date.now()}`, role: "user", text }]);
    startTransition(async () => {
      const { data, error: invokeError } = await createClient().functions.invoke<ChatResponse>("chat", {
        body: { message: text, chat_session_id: sessionId },
      });
      if (invokeError || !data) {
        setError("送れませんでした。通信の状態を確かめて、もう一度送ってください。");
        return;
      }
      setSessionId(data.chat_session_id);
      setMessages((current) => [...current, { id: `reply-${Date.now()}`, role: "assistant", text: data.reply }]);
    });
  };

  return (
    <div className="flex min-h-[calc(100dvh-220px)] flex-col">
      <h1 className="card-title">🐔 にわとりとおはなし</h1>
      <div className="flex-1" aria-live="polite">
        {messages.length === 0 && <div className="msg msg-bot">{GREETING}</div>}
        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role === "user" ? "msg-user" : "msg-bot"}`}>
            {m.text}
          </div>
        ))}
        {pending && <div className="msg msg-bot msg-typing">…考え中コケ</div>}
        <div ref={bottom} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <form
        className="chat-input-row sticky bottom-24"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="input flex-1"
          value={draft}
          maxLength={MAX_LENGTH}
          placeholder="メッセージを入力…"
          aria-label="にわとりへのメッセージ"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-sm !mt-0 w-auto px-4" disabled={pending || !draft.trim()}>
          送信
        </button>
      </form>
    </div>
  );
}
