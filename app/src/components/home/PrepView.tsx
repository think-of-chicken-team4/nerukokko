import { leavePrep } from "@/app/(main)/actions";
import type { EggPlace } from "@/lib/data/devices";
import type { EveningData } from "@/lib/data/evening";
import { formatDateTime, formatTime } from "@/lib/format";

import { StartSleepButton } from "./StartSleepButton";

// たまごの場所ごとの表示。眠る前は「巣の外」＝ベッドに置いた、とみなす
const EGG_PREP: Record<EggPlace, { sub: string; pill: string; ok: boolean }> = {
  away: { sub: "巣から出ています（ベッドに置けばOK）", pill: "OK", ok: true },
  bed: { sub: "ベッドの上です", pill: "OK", ok: true },
  nest: { sub: "まだ巣の中です。ベッドに置いてください", pill: "巣の中", ok: false },
  disconnected: { sub: "鶏とつながっていません。たまごの電源を確かめてください", pill: "未接続", ok: false },
  unknown: { sub: "わかりません（鶏がオフライン）", pill: "不明", ok: false },
};

// 就寝準備（APP-04）：今夜の設定とデバイスの準備を確かめて「眠りにつく」
export function PrepView({ data }: { data: EveningData }) {
  const { recommendation, nextAlarmAt, devices } = data;
  const egg = devices.eggRegistered ? EGG_PREP[devices.eggPlace] : { sub: "まだ登録されていません", pill: "未登録", ok: false };
  const ready = devices.chickenOnline === true && egg.ok;

  return (
    <>
      <div className="card">
        <h2 className="card-title">🌙 今夜の設定</h2>
        <div className="row">
          <div>
            <div className="row-label">就寝予定</div>
            <div className="row-sub">にわとりからの提案</div>
          </div>
          <span className="pill pill-gold">
            {recommendation ? formatTime(recommendation.recommended_bedtime) : "提案なし"}
          </span>
        </div>
        <div className="row">
          <div>
            <div className="row-label">起床アラーム</div>
            <div className="row-sub">設定タブで変更できます</div>
          </div>
          <span className="pill pill-blue">{nextAlarmAt ? formatDateTime(nextAlarmAt) : "8時間後"}</span>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">🥚 デバイスの準備</h2>
        <div className="row">
          <div>
            <div className="row-label">にわとり</div>
            <div className="row-sub">
              {devices.chickenOnline === null
                ? "まだ登録されていません（デバイスタブで登録）"
                : devices.chickenOnline
                  ? "オンライン"
                  : "オフラインです。電源と Wi-Fi を確かめてください"}
            </div>
          </div>
          <span className={`pill ${devices.chickenOnline ? "pill-blue" : "pill-pink"}`}>
            {devices.chickenOnline === null ? "未登録" : devices.chickenOnline ? "良好" : "未接続"}
          </span>
        </div>
        <div className="row">
          <div>
            <div className="row-label">たまごをベッドに置く</div>
            <div className="row-sub">{egg.sub}</div>
          </div>
          <span className={`pill ${egg.ok ? "pill-blue" : "pill-pink"}`}>{egg.pill}</span>
        </div>
      </div>

      <StartSleepButton />
      {!ready && (
        <p className="hint mt-3">
          ⚠️ 準備ができていなくても記録は始められますが、にわとりとたまごがつながっていないと、寝返りや呼吸が計測されません。
        </p>
      )}
      <form action={leavePrep}>
        <button type="submit" className="btn btn-ghost">
          ← 戻る
        </button>
      </form>
    </>
  );
}
