"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { callDeviceApi } from "@/lib/device-api";
import { formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

// 仮想の鶏・たまごの MAC アドレス（先頭 02 は「ローカルで決めたアドレス」を表す）
const CHICKEN_MAC = "02:00:00:00:00:01";
const EGG_MAC = "02:00:00:00:00:02";
const FIRMWARE = "simulator-0.1";
const AUTO_INTERVAL_MS = 3000;

export type ActiveSession = { id: string; start_time: string; planned_wake_time: string };
type Payload = Record<string, unknown>;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const round1 = (value: number) => Math.round(value * 10) / 10;
const nowIso = () => new Date().toISOString();

// ---------- デバイストークンの保存（このブラウザの localStorage） ----------
const TOKEN_STORAGE_KEY = "nerukokko-simulator-device-token";
const tokenListeners = new Set<() => void>();
let tokenInMemory: string | null = null; // localStorage が使えないときの予備

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? tokenInMemory;
  } catch {
    return tokenInMemory;
  }
}

function saveToken(token: string) {
  tokenInMemory = token;
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // 保存できなくても、この画面を開いている間は使える
  }
  tokenListeners.forEach((listener) => listener());
}

function subscribeToken(listener: () => void) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

// ---------- 送るデータ ----------
const motionNow = (): Payload => ({ motion_events: [{ timestamp: nowIso(), intensity: round1(rand(0.3, 1.5)), source: "accelerometer" }] });
const snoreNow = (): Payload => ({ audio_events: [{ timestamp: nowIso(), type: "snore", duration_ms: 1500, confidence: 0.8 }] });
const talkNow = (): Payload => ({ audio_events: [{ timestamp: nowIso(), type: "sleep_talk", duration_ms: 2500, confidence: 0.6 }] });
const breathingNow = (): Payload => ({ breathing: [{ timestamp: nowIso(), breaths_per_min: round1(rand(12.5, 15.5)), source: "mmwave" }] });
const environmentNow = (): Payload => ({
  environment: [{ timestamp: nowIso(), temperature_c: round1(rand(22, 26)), humidity_pct: round1(rand(42, 60)), illuminance_lux: 1 }],
});
const chargeNow = (type: "charge_start" | "charge_stop") => (): Payload => ({ charge_events: [{ timestamp: nowIso(), type }] });

/** 就寝から今までの一晩分のデータを作る（環境10分ごと・呼吸5分ごと・寝返り・いびき） */
function buildNight(start: Date, end: Date): Payload {
  const at = (ms: number) => new Date(ms).toISOString();
  const span = end.getTime() - start.getTime();
  const environment = [];
  const breathing = [];
  let temperature = rand(23, 25);
  for (let t = start.getTime(); t < end.getTime(); t += 5 * 60_000) {
    breathing.push({ timestamp: at(t), breaths_per_min: round1(rand(12.5, 15.5)), source: "mmwave" });
    if ((t - start.getTime()) % (10 * 60_000) === 0) {
      temperature = Math.min(28, Math.max(20, temperature + rand(-0.3, 0.3)));
      environment.push({
        timestamp: at(t),
        temperature_c: round1(temperature),
        humidity_pct: round1(rand(45, 58)),
        illuminance_lux: round1(rand(0, 3)),
      });
    }
  }
  const motion_events = Array.from({ length: Math.round(rand(10, 22)) }, () => ({
    timestamp: at(start.getTime() + 20 * 60_000 + Math.random() * Math.max(0, span - 20 * 60_000)),
    intensity: round1(rand(0.3, 1.8)),
    source: "accelerometer",
  }));
  const audio_events = Array.from({ length: Math.round(rand(0, 6)) }, () => ({
    timestamp: at(start.getTime() + Math.random() * span),
    type: Math.random() < 0.8 ? "snore" : "sleep_talk",
    duration_ms: Math.round(rand(800, 3000)),
    confidence: round1(rand(0.5, 0.9)),
  }));
  const presence_events = [{ timestamp: at(start.getTime() + 2 * 60_000), state: "in_bed" }];
  return { environment, breathing, motion_events, audio_events, presence_events };
}

export function SimulatorPanel({ userId, initialSession }: { userId: string; initialSession: ActiveSession | null }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const token = useSyncExternalStore(subscribeToken, readToken, () => null);
  const [session, setSession] = useState<ActiveSession | null>(initialSession);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const tick = useRef(0);

  const log = useCallback((message: string) => {
    setLogs((prev) => [`${formatTime(new Date())}  ${message}`, ...prev].slice(0, 30));
  }, []);

  const loadSession = useCallback(async () => {
    const { data } = await supabase
      .from("sleep_sessions")
      .select("id, start_time, planned_wake_time")
      .eq("status", "in_progress")
      .maybeSingle();
    setSession(data);
  }, [supabase]);

  /** 鶏として ingest-sensor-data に送り、結果をログに出す */
  const send = useCallback(
    async (label: string, items: Payload) => {
      if (!token) {
        log("先に「仮想の鶏・たまごを登録」を押してください");
        return;
      }
      const { status, body } = await callDeviceApi("ingest-sensor-data", token, {
        sent_at: nowIso(),
        firmware_version: FIRMWARE,
        egg: { mac_address: EGG_MAC, firmware_version: FIRMWARE, battery_level: Math.round(rand(60, 95)) },
        ...items,
      });
      const result = body as { accepted?: Record<string, number>; skipped?: { reason: string }[]; error?: { message: string } };
      if (status !== 200) {
        log(`${label}：失敗（${status}）${result.error?.message ?? ""}`);
        return;
      }
      const accepted = Object.entries(result.accepted ?? {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join("・");
      const skipped = result.skipped?.length ? ` ／ スキップ ${result.skipped.length}件（${result.skipped[0].reason} など）` : "";
      log(`${label}：受付 ${accepted || "なし"}${skipped}`);
    },
    [token, log],
  );

  /** ボタンの処理を実行し、終わったら記録中のセッションと画面を読み直す */
  async function runTask(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
      await loadSession();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const registerDevices = () =>
    runTask(async () => {
      const { data, error } = await supabase
        .rpc("register_device", { p_type: "chicken", p_mac_address: CHICKEN_MAC, p_firmware_version: FIRMWARE })
        .single();
      if (error || !data?.device_token) {
        log(`登録に失敗しました：${error?.message ?? "トークンがありません"}`);
        return;
      }
      saveToken(data.device_token);
      // たまごは、鶏が最初に状態を報告したときに自動で登録される
      await callDeviceApi("device-sync", data.device_token, {
        firmware_version: FIRMWARE,
        egg_mac_address: EGG_MAC,
        status: { egg_connected: true, egg_docked: true, egg_battery_level: 90 },
      });
      log("仮想の鶏・たまごを登録しました");
    });

  const startSession = (hoursAgo: number) =>
    runTask(async () => {
      const now = Date.now();
      let start = new Date(now - hoursAgo * 3600_000);
      // 前の記録と期間が重なると、計測データが前の記録に入ってしまうので、前の記録が終わった後から始める
      const { data: last } = await supabase
        .from("sleep_sessions")
        .select("end_time")
        .not("end_time", "is", null)
        .order("end_time", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (last?.end_time && new Date(last.end_time) >= start) {
        start = new Date(new Date(last.end_time).getTime() + 60_000);
        log(`前の記録と重ならないよう、就寝を ${formatTime(start)} にしました`);
      }
      // 早送り用（何時間も前に寝た）なら、起床予定は2分後にして「睡眠記録」のまま一晩分を送れるようにする
      const plannedWake = new Date(hoursAgo > 0 ? now + 2 * 60_000 : now + 8 * 3600_000);
      const { error } = await supabase.from("sleep_sessions").insert({
        user_id: userId,
        start_time: start.toISOString(),
        planned_wake_time: plannedWake.toISOString(),
      });
      log(error ? `睡眠を始められませんでした：${error.message}` : `睡眠を開始（就寝 ${formatTime(start)}）`);
    });

  const sendNow = (label: string, build: () => Payload) => runTask(() => send(label, build()));

  const sendNight = () =>
    runTask(async () => {
      if (!session) {
        log("先に睡眠を開始してください");
        return;
      }
      await send("一晩分のデータ", buildNight(new Date(session.start_time), new Date(Date.now() - 30_000)));
    });

  const sync = () =>
    runTask(async () => {
      if (!token) return;
      const { status, body } = await callDeviceApi("device-sync", token, {
        firmware_version: FIRMWARE,
        egg_mac_address: EGG_MAC,
        status: { alarm_ringing: false, egg_connected: true, egg_docked: !session, egg_battery_level: 88, temperature_c: 24.2 },
      });
      const alarm = (body as { alarm?: { ring_at: string; source: string } | null }).alarm;
      log(
        status === 200
          ? `同期：次に鳴らす時刻 ${alarm ? `${formatTime(alarm.ring_at)}（${alarm.source === "session" ? "起床予定" : "アラーム"}）` : "なし"}`
          : `同期：失敗（${status}）`,
      );
    });

  // 自動送信：3秒ごとに、ときどき寝返り・いびきを起こし、呼吸と環境も送る
  useEffect(() => {
    if (!auto || !token) return;
    const timer = setInterval(() => {
      tick.current += 1;
      const items: Payload = {
        ...(Math.random() < 0.35 ? motionNow() : {}),
        ...(Math.random() < 0.12 ? snoreNow() : {}),
        ...(tick.current % 5 === 0 ? breathingNow() : {}),
        ...(tick.current % 10 === 0 ? environmentNow() : {}),
      };
      if (Object.keys(items).length > 0) void send("自動送信", items);
    }, AUTO_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [auto, token, send]);

  const disabled = busy || !token;

  return (
    <>
      <div className="hint">
        🔧 実機（鶏・たまご）の代わりに、鶏と同じ API へデータを送る開発・デモ用の画面です。送ったデータは本物の計測と同じように記録されます。
        「仮想の鶏・たまごを登録」すると、登録済みの実機の鶏・たまごは仮想のものに置き換わります。
      </div>

      <div className="card">
        <h2 className="card-title">🐔 1. 仮想デバイス</h2>
        <div className="row">
          <div>
            <div className="row-label">鶏 {CHICKEN_MAC}</div>
            <div className="row-sub">{token ? "登録済み（トークンをこのブラウザに保存）" : "未登録"}</div>
          </div>
          <span className={`pill ${token ? "pill-blue" : "pill-pink"}`}>{token ? "OK" : "未登録"}</span>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={registerDevices}>
          仮想の鶏・たまごを登録
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={sync}>
          状態を報告して次のアラームを受け取る（device-sync）
        </button>
      </div>

      <div className="card">
        <h2 className="card-title">🌙 2. 睡眠</h2>
        <p className="muted">
          {session
            ? `記録中：就寝 ${formatTime(session.start_time)}、起床予定 ${formatTime(session.planned_wake_time)}`
            : "記録中のセッションはありません"}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !!session} onClick={() => startSession(0)}>
            今から眠る
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !!session} onClick={() => startSession(8)}>
            8時間前に寝たことにする
          </button>
        </div>
        <p className="muted mt-2">
          「8時間前に寝たことにする」は、前の記録と重ならないよう前の記録の終わりより後から始めます。同じ日に何度も試すと一晩が短くなるので、そのときは
          <code className="mx-1">npx supabase db reset</code>でローカルのデータを消してください。
        </p>
      </div>

      <div className="card">
        <h2 className="card-title">📡 3. 計測データを送る</h2>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary btn-sm !mt-0" disabled={disabled} onClick={() => sendNow("寝返り", motionNow)}>
            🔄 寝返り
          </button>
          <button type="button" className="btn btn-secondary btn-sm !mt-0" disabled={disabled} onClick={() => sendNow("いびき", snoreNow)}>
            😮 いびき
          </button>
          <button type="button" className="btn btn-secondary btn-sm !mt-0" disabled={disabled} onClick={() => sendNow("寝言", talkNow)}>
            💬 寝言
          </button>
          <button type="button" className="btn btn-secondary btn-sm !mt-0" disabled={disabled} onClick={() => sendNow("室温・湿度", environmentNow)}>
            🌡 室温・湿度
          </button>
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled || !session} onClick={sendNight}>
          ⏭ 就寝から今までの一晩分をまとめて送る
        </button>
        <label className="row mt-2">
          <span className="row-label">自動送信（3秒ごと）</span>
          <input type="checkbox" checked={auto} disabled={!token} onChange={(e) => setAuto(e.target.checked)} />
        </label>
      </div>

      <div className="card">
        <h2 className="card-title">🪺 4. 巣</h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => sendNow("巣から取り出す", chargeNow("charge_stop"))}>
            巣から取り出す
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={() => sendNow("巣に戻す（起床）", chargeNow("charge_start"))}>
            巣に戻す（起床）
          </button>
        </div>
        <p className="muted mt-2">「巣に戻す」と記録が完了し、数秒でホームに朝のスコアが出ます。</p>
      </div>

      <div className="card">
        <h2 className="card-title">📜 ログ</h2>
        {logs.length === 0 ? (
          <p className="muted">まだ何も送っていません</p>
        ) : (
          <ul className="space-y-1 font-mono text-[11px] text-[var(--fg-dim)]">
            {logs.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
