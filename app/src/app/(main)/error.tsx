"use client";

import { ErrorView } from "@/components/ErrorView";

// 各タブの画面でエラーが起きたとき。上部のステータスと下部のタブは残る
export default function MainError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorView {...props} />;
}
