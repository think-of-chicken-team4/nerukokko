import { ChatPanel, type ChatMessage } from "@/components/chat/ChatPanel";
import { createClient } from "@/lib/supabase/server";

const HISTORY_LIMIT = 50;

// にわとりとのチャット（APP-12、T-110）。いちばん新しいアプリでの会話の続きを表示する
export default async function ChatPage() {
  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("trigger", "app")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`会話を読めませんでした: ${error.message}`);

  let messages: ChatMessage[] = [];
  if (session) {
    const { data, error: messagesError } = await supabase
      .from("chat_messages")
      .select("id, role, content")
      .eq("chat_session_id", session.id)
      .order("id", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (messagesError) throw new Error(`会話を読めませんでした: ${messagesError.message}`);
    messages = (data ?? []).reverse().map((m) => ({ id: String(m.id), role: m.role === "user" ? "user" : "assistant", text: m.content }));
  }

  return <ChatPanel initialSessionId={session?.id ?? null} initialMessages={messages} />;
}
