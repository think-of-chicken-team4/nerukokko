"use client";

import { useEffect } from "react";

import { ChickenBubble } from "@/components/ui/ChickenBubble";

type Props = { error: Error & { digest?: string }; retry: () => void };

// 予期しないエラーが起きたときの表示（app/error.tsx・app/(main)/error.tsx から使う）。retry() でもう一度読み込む
export function ErrorView({ error, retry }: Props) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <ChickenBubble>うまく表示できなかったコケ…。通信の状態を確かめて、もう一度試してほしいコケ。</ChickenBubble>
      <button type="button" className="btn btn-primary" onClick={() => retry()}>
        もう一度読み込む
      </button>
      {error.digest && <p className="muted mt-3 text-center">エラー番号：{error.digest}</p>}
    </>
  );
}
