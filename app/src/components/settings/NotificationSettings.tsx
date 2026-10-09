"use client";

import { useOptimistic, useState, useTransition } from "react";

import { updateNotificationSettings, type NotificationSettings } from "@/app/(main)/settings/actions";
import { Switch } from "@/components/ui/Switch";

const NOTIFICATIONS = [
  { key: "evening_suggestion", label: "夕方の就寝提案", sub: "明日の予定から、今夜寝る時刻を19時ごろに提案します" },
  { key: "morning_score", label: "朝のスコア通知", sub: "たまごを巣に戻したあと、睡眠スコアをお知らせします" },
] as const;

const VOICES = [
  { value: "rooster", label: "にわとり（標準）" },
  { value: "chick", label: "ひよこ（高め）" },
] as const;

// 設定 →「🔔 通知」「🐔 キャラクターボイス」（T-103）。押すとすぐに表示を変え、裏で保存する
export function NotificationSettingsCards({ settings }: { settings: NotificationSettings }) {
  const [current, applyOptimistic] = useOptimistic(settings, (state, patch: Partial<NotificationSettings>) => ({
    ...state,
    ...patch,
  }));
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();

  const update = (patch: Partial<NotificationSettings>) =>
    startTransition(async () => {
      applyOptimistic(patch);
      const result = await updateNotificationSettings(patch);
      setError(result.error);
    });

  return (
    <>
      <div className="card">
        <h2 className="card-title">🔔 通知</h2>
        {NOTIFICATIONS.map((item) => (
          <div key={item.key} className="row">
            <div>
              <div className="row-label">{item.label}</div>
              <div className="row-sub">{item.sub}</div>
            </div>
            <Switch
              checked={current[item.key]}
              label={item.label}
              onCheckedChange={(next) => update({ [item.key]: next })}
            />
          </div>
        ))}
        {error && <p className="error-text">{error}</p>}
      </div>

      <div className="card">
        <h2 className="card-title">🐔 キャラクターボイス</h2>
        <p className="muted mb-1">にわとりが話すときの声です。</p>
        <div className="btn-row" role="radiogroup" aria-label="キャラクターボイス">
          {VOICES.map((voice) => {
            const selected = current.character_voice === voice.value;
            return (
              <button
                key={voice.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`btn btn-sm ${selected ? "btn-primary" : "btn-secondary"}`}
                onClick={() => !selected && update({ character_voice: voice.value })}
              >
                {voice.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
