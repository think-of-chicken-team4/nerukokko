"use client";

import { useEffect, useState, useTransition } from "react";

import { abortSleep } from "@/app/(main)/actions";
import { formatTime } from "@/lib/format";
import type { SleepCounts } from "@/lib/data/sleep";
import { createClient } from "@/lib/supabase/client";
import { subscribeAsUser } from "@/lib/supabase/realtime";

type Props = {
  sessionId: string;
  startTime: string;
  plannedWakeTime: string;
  initial: SleepCounts;
};

function elapsedText(startTime: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 60000));
  return `${Math.floor(minutes / 60)}時間${minutes % 60}分`;
}

// 睡眠中の画面。鶏から届いた寝返り・いびき・室温を Realtime で即時に反映する
export function SleepMonitor({ sessionId, startTime, plannedWakeTime, initial }: Props) {
  const [counts, setCounts] = useState(initial);
  const [elapsed, setElapsed] = useState(() => elapsedText(startTime));
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const filter = `session_id=eq.${sessionId}`;
    return subscribeAsUser(createClient(), `sleep-monitor-${sessionId}`, (channel) =>
      channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "motion_events", filter }, () =>
          setCounts((c) => ({ ...c, turns: c.turns + 1 })),
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "audio_events", filter }, () =>
          setCounts((c) => ({ ...c, snores: c.snores + 1 })),
        )
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "environment_readings", filter }, (payload) => {
          const row = payload.new as { temperature_c: number | null; humidity_pct: number | null };
          setCounts((c) => ({
            ...c,
            temperatureC: row.temperature_c ?? c.temperatureC,
            humidityPct: row.humidity_pct ?? c.humidityPct,
          }));
        }),
    );
  }, [sessionId]);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(elapsedText(startTime)), 30_000);
    return () => clearInterval(timer);
  }, [startTime]);

  return (
    <>
      <div className="card">
        <h2 className="card-title">😴 睡眠モニタリング中</h2>
        <div className="mt-1.5 mb-3.5 text-center">
          <div className="font-num text-[34px] font-bold">{elapsed}</div>
          <div className="muted">
            経過（就寝 {formatTime(startTime)} 〜 起床予定 {formatTime(plannedWakeTime)}）
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">🔄 寝返り</div>
            <div className="stat-value">{counts.turns}回</div>
          </div>
          <div className="stat">
            <div className="stat-label">😮 いびき・寝言</div>
            <div className="stat-value">{counts.snores}回</div>
          </div>
          <div className="stat">
            <div className="stat-label">🌡 室温</div>
            <div className="stat-value">{counts.temperatureC != null ? `${counts.temperatureC.toFixed(1)}℃` : "—"}</div>
          </div>
          <div className="stat">
            <div className="stat-label">💧 湿度</div>
            <div className="stat-value">{counts.humidityPct != null ? `${Math.round(counts.humidityPct)}%` : "—"}</div>
          </div>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={pending}
        onClick={() => {
          if (confirm("記録を中止しますか？（この夜のスコアは出ません）")) {
            startTransition(async () => {
              await abortSleep(sessionId);
            });
          }
        }}
      >
        記録を中止する
      </button>
    </>
  );
}
