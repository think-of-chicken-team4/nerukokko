import Link from "next/link";

import { ChickenBubble } from "@/components/ui/ChickenBubble";

// ログイン後の画面で、ページや記録が見つからないとき（notFound()）
export default function NotFound() {
  return (
    <>
      <ChickenBubble>そのページは見つからなかったコケ…。消えてしまったか、アドレスがまちがっているかもしれないコケ。</ChickenBubble>
      <Link href="/" className="btn btn-primary">
        ホームへ戻る
      </Link>
    </>
  );
}
