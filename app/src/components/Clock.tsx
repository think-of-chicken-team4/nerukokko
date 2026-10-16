"use client";

import { useEffect, useState } from "react";

import { formatTime } from "@/lib/format";

// ステータスバーの時計。サーバーで描いた時刻から始めて、毎分0秒に進める
export function Clock({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = new Date();
      setText(formatTime(now));
      timer = setTimeout(tick, 60_000 - (now.getTime() % 60_000));
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, []);

  return <time>{text}</time>;
}
