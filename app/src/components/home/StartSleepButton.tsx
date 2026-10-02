"use client";

import { useState, useTransition } from "react";

import { startSleep } from "@/app/(main)/actions";

// 「眠りにつく」ボタン。押すと睡眠セッションを始め、ホームが「睡眠記録」に切り替わる
export function StartSleepButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await startSleep();
            setError(result.error);
          })
        }
      >
        {pending ? "記録を始めています…" : "眠りにつく 🌙"}
      </button>
      {error && <p className="error-text">{error}</p>}
    </>
  );
}
