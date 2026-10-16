"use client";

import { ErrorView } from "@/components/ErrorView";

// 共通の枠（app/(main)/layout.tsx）の読み込み自体でエラーが起きたとき
export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="phase-screen">
      <main className="mx-auto max-w-[430px] px-4 pt-16">
        <ErrorView {...props} />
      </main>
    </div>
  );
}
