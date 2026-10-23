import Link from "next/link";
import { notFound } from "next/navigation";

import { NightRecordView } from "@/components/records/NightRecordView";
import { getNightRecord } from "@/lib/data/night";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 過去の1晩の記録（/records/[sessionId]）。別のユーザーの記録は RLS で読めないので「見つからない」になる
export default async function PastNightPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  if (!UUID.test(sessionId)) notFound();

  const supabase = await createClient();
  const record = await getNightRecord(supabase, sessionId);
  if (!record) notFound();

  return (
    <>
      <Link href="/records?view=week" className="muted mb-3 inline-block">
        ← 記録の一覧へ
      </Link>
      <NightRecordView record={record} />
    </>
  );
}
