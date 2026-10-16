import Link from "next/link";

import { enterPrep } from "@/app/(main)/actions";
import { ChickenBubble } from "@/components/ui/ChickenBubble";
import type { EveningData } from "@/lib/data/evening";
import { formatDateTime, formatTime } from "@/lib/format";

// 夕方確認（APP-03）：明日の予定・今夜の就寝提案・にわとりのひとこと →「就寝準備へ進む」
export function DuskView({ name, data }: { name: string; data: EveningData }) {
  const { recommendation, nextAlarmAt } = data;

  return (
    <>
      {recommendation?.first_event_title && (
        <div className="card">
          <div className="eyebrow">明日の予定（カレンダー）</div>
          <div className="mb-1 text-sm font-bold">{recommendation.first_event_title}</div>
          <div className="muted">
            {recommendation.first_event_start && `${formatDateTime(recommendation.first_event_start)} から`}
            {recommendation.recommended_wake_time && `／起きる時刻 ${formatTime(recommendation.recommended_wake_time)}`}
          </div>
        </div>
      )}

      <ChickenBubble>
        {name && <span className="font-bold">{name}さん、</span>}
        今日も一日おつかれさまコケ！
        {recommendation ? (
          <>
            今夜は <b>{formatTime(recommendation.recommended_bedtime)}</b> までに寝るのがおすすめコケ。
            {recommendation.reasoning}
          </>
        ) : (
          <>夜の準備ができたら「就寝準備へ進む」を押してほしいコケ🌙</>
        )}
      </ChickenBubble>

      <div className="card">
        <h2 className="card-title">⏰ 明日の朝</h2>
        <div className="row">
          <div>
            <div className="row-label">起床アラーム</div>
            <div className="row-sub">
              <Link href="/settings" className="underline">
                設定
              </Link>
              で変更できます
            </div>
          </div>
          <span className="pill pill-blue">{nextAlarmAt ? formatDateTime(nextAlarmAt) : "未設定（8時間後）"}</span>
        </div>
      </div>

      <Link href="/chat" className="btn btn-secondary">
        🐔 にわとりと話す
      </Link>
      <form action={enterPrep}>
        <button type="submit" className="btn btn-primary">
          {recommendation ? "提案どおり、就寝準備へ進む →" : "就寝準備へ進む →"}
        </button>
      </form>
      {!recommendation && <p className="hint mt-3">💡 カレンダー連携ができると、明日の予定から今夜寝る時刻を提案します。</p>}
    </>
  );
}
