"use client";

import { useOptimistic, useState, useTransition } from "react";

import { deleteAlarm, saveAlarm, setAlarmEnabled } from "@/app/(main)/settings/actions";
import { Switch } from "@/components/ui/Switch";
import {
  ALL_DAYS,
  DAY_LABELS,
  formatAlarmTime,
  formatRepeatDays,
  MAX_ALARMS,
  WEEK_ORDER,
} from "@/lib/alarm";

export type Alarm = { id: string; time: string; repeat_days: number[]; enabled: boolean };

const NEW_ALARM = { time: "07:00", days: ALL_DAYS };

const PRESETS = [
  { label: "毎日", days: ALL_DAYS },
  { label: "平日", days: [1, 2, 3, 4, 5] },
  { label: "土日", days: [0, 6] },
] as const;

// 設定 →「⏰ アラーム」：一覧・追加・編集・削除・ON/OFF（T-102）
export function AlarmSettings({ alarms }: { alarms: Alarm[] }) {
  // 編集中のアラームの id。新しく追加するときは "new"
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <>
      {alarms.length === 0 && editing !== "new" && (
        <p className="muted">アラームがありません。ないときは「眠りにつく」から8時間後に起こします。</p>
      )}
      {alarms.map((alarm) =>
        editing === alarm.id ? (
          <AlarmEditor
            key={alarm.id}
            id={alarm.id}
            initial={{ time: formatAlarmTime(alarm.time), days: alarm.repeat_days }}
            onDone={() => setEditing(null)}
          />
        ) : (
          <AlarmRow key={alarm.id} alarm={alarm} onEdit={() => setEditing(alarm.id)} />
        ),
      )}
      {editing === "new" ? (
        <AlarmEditor id={null} initial={NEW_ALARM} onDone={() => setEditing(null)} />
      ) : (
        editing === null &&
        alarms.length < MAX_ALARMS && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing("new")}>
            ＋ アラームを追加
          </button>
        )
      )}
    </>
  );
}

function AlarmRow({ alarm, onEdit }: { alarm: Alarm; onEdit: () => void }) {
  const [enabled, setOptimisticEnabled] = useOptimistic(alarm.enabled);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  const time = formatAlarmTime(alarm.time);

  return (
    <div className="row">
      <button
        type="button"
        className={`flex-1 text-left ${enabled ? "" : "opacity-50"}`}
        aria-label={`${time}（${formatRepeatDays(alarm.repeat_days)}）のアラームを編集`}
        onClick={onEdit}
      >
        <div className="font-num text-[26px] leading-tight font-bold">{time}</div>
        <div className="row-sub">
          {formatRepeatDays(alarm.repeat_days)}
          {error && <span className="ml-2 text-[var(--error-fg)]">{error}</span>}
        </div>
      </button>
      <Switch
        checked={enabled}
        label={`${time}のアラーム`}
        onCheckedChange={(next) =>
          startTransition(async () => {
            setOptimisticEnabled(next);
            const result = await setAlarmEnabled(alarm.id, next);
            setError(result.error);
          })
        }
      />
    </div>
  );
}

type EditorProps = {
  id: string | null;
  initial: { time: string; days: readonly number[] };
  onDone: () => void;
};

function AlarmEditor({ id, initial, onDone }: EditorProps) {
  const [time, setTime] = useState(initial.time);
  const [days, setDays] = useState<number[]>([...initial.days]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const toggleDay = (day: number) =>
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));

  const run = (action: () => Promise<{ error?: string }>) =>
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else onDone();
    });

  return (
    <div className="my-2 rounded-2xl bg-[var(--inset)] p-3">
      <label className="flex items-center justify-between gap-3">
        <span className="row-label">起床時刻</span>
        <input
          type="time"
          className="input w-[130px]"
          value={time}
          required
          onChange={(e) => setTime(e.target.value)}
        />
      </label>

      <div className="mt-3 mb-1.5 flex items-center justify-between">
        <span className="row-label">鳴らす曜日</span>
        <span className="flex gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              className="pill pill-gold"
              onClick={() => setDays([...preset.days])}
            >
              {preset.label}
            </button>
          ))}
        </span>
      </div>
      <div className="flex justify-between" role="group" aria-label="鳴らす曜日">
        {WEEK_ORDER.map((day) => (
          <button
            key={day}
            type="button"
            className="day-chip"
            aria-pressed={days.includes(day)}
            onClick={() => toggleDay(day)}
          >
            {DAY_LABELS[day]}
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="btn-row mt-3">
        <button type="button" className="btn btn-sm btn-secondary" disabled={pending} onClick={onDone}>
          やめる
        </button>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          disabled={pending || days.length === 0}
          onClick={() => run(() => saveAlarm(id, { time, days }))}
        >
          {pending ? "保存中…" : "保存"}
        </button>
      </div>
      {id && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={pending}
          onClick={() => {
            if (confirm(`${time}のアラームを削除しますか？`)) run(() => deleteAlarm(id));
          }}
        >
          このアラームを削除
        </button>
      )}
    </div>
  );
}
