// にわとりのセリフの吹き出し
export function ChickenBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="chat-bubble">
      <div className="chat-avatar" aria-hidden>
        🐔
      </div>
      <div>{children}</div>
    </div>
  );
}
