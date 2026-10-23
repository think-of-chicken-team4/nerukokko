"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { callDeviceApi } from "@/lib/device-api";
import { formatTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

/**
 * 仮想の鶏・たまごの MAC アドレス（先頭 02 は「ローカルで決めたアドレス」を表す）。
 * MAC は全ユーザーで1台にしか登録できないので、アカウントごとに変える（ユーザー ID の先頭から作る）
 */
function virtualMac(userId: string, last: "01" | "02"): string {
  const hex = userId.replace(/-/g, "").slice(0, 8).toUpperCase().padEnd(8, "0");
  return ["02", ...(hex.match(/../g) ?? []), last].join(":");
}
const FIRMWARE = "simulator-0.1";
const AUTO_INTERVAL_MS = 3000;

export type ActiveSession = { id: string; start_time: string; planned_wake_time: string };
type Payload = Record<string, unknown>;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const round1 = (value: number) => Math.round(value * 10) / 10;
const nowIso = () => new Date().toISOString();

// ---------- デバイストークンの保存（このブラウザの localStorage。アカウントごと） ----------
const tokenKey = (userId: string) => `nerukokko-simulator-device-token:${userId}`;
const tokenListeners = new Set<() => void>();
const tokensInMemory = new Map<string, string>(); // localStorage が使えないときの予備

function readToken(userId: string): string | null {
  try {
    return localStorage.getItem(tokenKey(userId)) ?? tokensInMemory.get(userId) ?? null;
  } catch {
    return tokensInMemory.get(userId) ?? null;
  }
}

function saveToken(userId: string, token: string) {
  tokensInMemory.set(userId, token);
  try {
    localStorage.setItem(tokenKey(userId), token);
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

/** 一晩分のデータを、計測時刻で区切って分ける（デモの早回しで、1時間ずつ順に送るため） */
function splitByTime(night: Payload, start: Date, end: Date, parts: number): Payload[] {
  const step = (end.getTime() - start.getTime()) / parts;
  return Array.from({ length: parts }, (_, i) => {
    const from = start.getTime() + step * i;
    const to = i === parts - 1 ? Infinity : from + step;
    return Object.fromEntries(
      Object.entries(night).map(([key, items]) => [
        key,
        (items as { timestamp: string }[]).filter((item) => {
          const t = new Date(item.timestamp).getTime();
          return t >= from && t < to;
        }),
      ]),
    );
  });
}

/** デモの1場面の長さ（ミリ秒）。発表では、場面ごとにスマホの画面を見せながら話す */
const DEMO_SPEEDS = [
  { label: "ゆっくり（1場面 8秒）", ms: 8000 },
  { label: "ふつう（4秒）", ms: 4000 },
  { label: "はやい（1.5秒）", ms: 1500 },
] as const;
/** 一晩を何回に分けて送るか（1時間ずつ） */
const DEMO_NIGHT_PARTS = 8;
/** デモの一晩として最低限ほしい長さ（これより短いと始めない） */
const DEMO_MIN_NIGHT_MS = 2 * 3600_000;

class DemoStopped extends Error {}
class DemoFailed extends Error {}

export function SimulatorPanel({ userId, initialSession }: { userId: string; initialSession: ActiveSession | null }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const token = useSyncExternalStore(subscribeToken, () => readToken(userId), () => null);
  const chickenMac = virtualMac(userId, "01");
  const eggMac = virtualMac(userId, "02");
  const [session, setSession] = useState<ActiveSession | null>(initialSession);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  // たまごが巣にあるか。本物の鶏は Dock Event で知り、device-sync で報告する（ホームの就寝準備・デバイス画面に出る）
  const [docked, setDocked] = useState(true);
  const tick = useRef(0);
  const [demoStep, setDemoStep] = useState<string | null>(null);
  const [demoSpeed, setDemoSpeed] = useState(1);
  const demoStop = useRef(false);

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

  /** 鶏として ingest-sensor-data に送り、結果をログに出す。受け付けられたら true */
  const send = useCallback(
    async (label: string, items: Payload, deviceToken: string | null = token): Promise<boolean> => {
      if (!deviceToken) {
        log("先に「仮想の鶏・たまごを登録」を押してください");
        return false;
      }
      const { status, body } = await callDeviceApi("ingest-sensor-data", deviceToken, {
        sent_at: nowIso(),
        firmware_version: FIRMWARE,
        egg: { mac_address: eggMac, firmware_version: FIRMWARE, battery_level: Math.round(rand(60, 95)) },
        ...items,
      });
      const result = body as { accepted?: Record<string, number>; skipped?: { reason: string }[]; error?: { message: string } };
      if (status !== 200) {
        log(`${label}：失敗（${status}）${result.error?.message ?? ""}`);
        return false;
      }
      const accepted = Object.entries(result.accepted ?? {})
        .filter(([, n]) => n > 0)
        .map(([k, n]) => `${k} ${n}`)
        .join("・");
      const skipped = result.skipped?.length ? ` ／ スキップ ${result.skipped.length}件（${result.skipped[0].reason} など）` : "";
      log(`${label}：受付 ${accepted || "なし"}${skipped}`);
      return true;
    },
    [token, log, eggMac],
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

  /** 仮想の鶏を登録してトークンを保存する。できなければ null */
  const doRegister = async (): Promise<string | null> => {
    const { data, error } = await supabase
      .rpc("register_device", { p_type: "chicken", p_mac_address: chickenMac, p_firmware_version: FIRMWARE })
      .single();
    if (error || !data?.device_token) {
      log(`登録に失敗しました：${error?.message ?? "トークンがありません"}`);
      return null;
    }
    saveToken(userId, data.device_token);
    // たまごは、鶏が最初に状態を報告したときに自動で登録される
    await callDeviceApi("device-sync", data.device_token, {
      firmware_version: FIRMWARE,
      egg_mac_address: eggMac,
      status: { egg_connected: true, egg_docked: true, egg_battery_level: 90 },
    });
    setDocked(true);
    log("仮想の鶏・たまごを登録しました");
    return data.device_token;
  };
  const registerDevices = () => runTask(async () => void (await doRegister()));

  /** いちばん最近に終わった記録の終わりの時刻 */
  const lastEndTime = async (): Promise<Date | null> => {
    const { data } = await supabase
      .from("sleep_sessions")
      .select("end_time")
      .not("end_time", "is", null)
      .order("end_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.end_time ? new Date(data.end_time) : null;
  };

  /** 睡眠を始める（hoursAgo 時間前に寝たことにもできる）。始めた記録を返す */
  const doStartSession = async (hoursAgo: number): Promise<ActiveSession | null> => {
    const now = Date.now();
    let start = new Date(now - hoursAgo * 3600_000);
    // 前の記録と期間が重なると、計測データが前の記録に入ってしまうので、前の記録が終わった後から始める
    const lastEnd = await lastEndTime();
    if (lastEnd && lastEnd >= start) {
      start = new Date(lastEnd.getTime() + 60_000);
      log(`前の記録と重ならないよう、就寝を ${formatTime(start)} にしました`);
    }
    // 早送り用（何時間も前に寝た）なら、起床予定は2分後にして「睡眠記録」のまま一晩分を送れるようにする
    const plannedWake = new Date(hoursAgo > 0 ? now + 2 * 60_000 : now + 8 * 3600_000);
    const { data, error } = await supabase
      .from("sleep_sessions")
      .insert({ user_id: userId, start_time: start.toISOString(), planned_wake_time: plannedWake.toISOString() })
      .select("id, start_time, planned_wake_time")
      .single();
    log(error ? `睡眠を始められませんでした：${error.message}` : `睡眠を開始（就寝 ${formatTime(start)}）`);
    return data;
  };
  const startSession = (hoursAgo: number) => runTask(async () => void (await doStartSession(hoursAgo)));

  const sendNow = (label: string, build: () => Payload) => runTask(async () => void (await send(label, build())));

  const sendNight = () =>
    runTask(async () => {
      if (!session) {
        log("先に睡眠を開始してください");
        return;
      }
      await send("一晩分のデータ", buildNight(new Date(session.start_time), new Date(Date.now() - 30_000)));
    });

  /** 鶏と同じように、今の状態（たまごが巣にあるか など）を device-sync で報告する */
  const reportStatus = useCallback(
    (eggDocked: boolean, deviceToken: string | null = token) =>
      callDeviceApi("device-sync", deviceToken!, {
        firmware_version: FIRMWARE,
        egg_mac_address: eggMac,
        status: { alarm_ringing: false, egg_connected: true, egg_docked: eggDocked, egg_battery_level: 88, temperature_c: 24.2 },
      }),
    [token, eggMac],
  );

  /** 巣から取り出す・巣に戻す：充電イベントを送り、鶏と同じようにすぐ状態も報告する */
  const doMoveEgg = async (toNest: boolean, deviceToken: string | null = token): Promise<boolean> => {
    const ok = await send(toNest ? "巣に戻す（起床）" : "巣から取り出す", chargeNow(toNest ? "charge_start" : "charge_stop")(), deviceToken);
    if (!ok) return false;
    setDocked(toNest);
    if (deviceToken) await reportStatus(toNest, deviceToken);
    return true;
  };
  const moveEgg = (toNest: boolean) => runTask(async () => void (await doMoveEgg(toNest)));

  /** 夕方の就寝提案を、19時を待たずに今すぐ作る（デモ用。evening-suggestion をログイン中のユーザーとして呼ぶ） */
  const doSuggestion = async () => {
    const { data, error } = await supabase.functions.invoke<{
      recommendation: { recommended_bedtime: string } | null;
    }>("evening-suggestion", { body: {} });
    if (error) {
      log(`就寝提案：失敗（${error.message}）`);
      return;
    }
    log(
      data?.recommendation
        ? `就寝提案：${formatTime(data.recommendation.recommended_bedtime)} までに寝る（ホームの夕方確認に出ます）`
        : "就寝提案：24時間以内のアラームも明日の予定もないので作りませんでした（設定でアラームを入れてください）",
    );
  };
  const makeSuggestion = () => runTask(doSuggestion);

  /**
   * 発表用デモ（T-305）：夕方の提案 → 就寝準備 → 眠る → 一晩を早回し → 起床 を、場面ごとに間をあけて自動で進める。
   * 別の端末（スマホ）でホームを開いておくと、Realtime で画面が切り替わっていく。
   */
  const runDemo = async () => {
    const pause = DEMO_SPEEDS[demoSpeed].ms;
    const wait = async (ms: number) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if (demoStop.current) throw new DemoStopped();
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    const scene = async (label: string, task: () => Promise<boolean | void>) => {
      if (demoStop.current) throw new DemoStopped();
      setDemoStep(label);
      log(`🎬 ${label}`);
      if ((await task()) === false) throw new DemoFailed(label);
      await loadSession();
      router.refresh();
      await wait(pause);
    };

    demoStop.current = false;
    setBusy(true);
    try {
      // 保存してあるトークンが使えるか確かめる（DB を作り直した・実機の鶏を登録したなどで使えなくなっていれば登録し直す）
      let deviceToken = token;
      if (deviceToken && (await reportStatus(docked, deviceToken)).status === 401) deviceToken = null;
      if (!deviceToken) deviceToken = await doRegister();
      if (!deviceToken) return;
      if (session) {
        log("記録中の睡眠があるので、先に「巣に戻す（起床）」で終わらせてください");
        return;
      }
      // 一晩は「前の記録の終わり」より後にしか置けない。短すぎると何も記録されないので始めない
      const lastEnd = await lastEndTime();
      if (lastEnd && Date.now() - lastEnd.getTime() < DEMO_MIN_NIGHT_MS) {
        log(
          `🎬 前の記録が ${formatTime(lastEnd)} に終わったばかりで、一晩分の時間が取れません。新しいアカウントで再生してください（ローカルなら npx supabase db reset でも可）`,
        );
        return;
      }
      await scene("夕方：にわとりが今夜の就寝時刻を提案", doSuggestion);
      await scene("就寝準備：たまごを巣から取り出す", () => doMoveEgg(false, deviceToken));
      let night: ActiveSession | null = null;
      await scene("就寝：眠りにつく（8時間前に寝たことにする）", async () => {
        night = await doStartSession(8);
        return night !== null;
      });
      const start = new Date((night as ActiveSession | null)!.start_time);
      const end = new Date(Date.now() - 30_000);
      if (end.getTime() - start.getTime() < 7 * 3600_000) {
        log("⚠ 前の記録と重ならないよう就寝を遅らせたので、一晩が短くなっています（デモ用のアカウントは1日1回の再生がおすすめ）");
      }
      const parts = splitByTime(buildNight(start, end), start, end, DEMO_NIGHT_PARTS);
      for (const [i, part] of parts.entries()) {
        if (demoStop.current) throw new DemoStopped();
        setDemoStep(`睡眠中：一晩を早回し（${i + 1}/${parts.length}）`);
        if (!(await send(`一晩の${i + 1}/${parts.length}`, part, deviceToken))) throw new DemoFailed("一晩の早回し");
        router.refresh();
        await wait(Math.max(800, pause / 4));
      }
      await wait(pause);
      await scene("起床：たまごを巣に戻す → 朝のスコア", () => doMoveEgg(true, deviceToken));
      log("🎬 デモが終わりました。ホームに朝のスコアとにわとりのコメントが出ます");
    } catch (e) {
      if (e instanceof DemoFailed) log(`🎬 「${e.message}」でうまくいかなかったので止めました（上のログを確かめてください）`);
      else if (e instanceof DemoStopped) log("🎬 デモを止めました（記録中の睡眠は「巣に戻す（起床）」で終わらせられます）");
      else throw e;
    } finally {
      setDemoStep(null);
      setBusy(false);
      await loadSession();
      router.refresh();
    }
  };

  const sync = () =>
    runTask(async () => {
      if (!token) return;
      const { status, body } = await reportStatus(docked);
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
        <h2 className="card-title">🎬 発表用デモ（1日の流れを自動で再生）</h2>
        <p className="muted mb-1">
          夕方の提案 → たまごを取り出す → 眠る → 一晩を早回し（1時間ずつ8回）→ 巣に戻して朝のスコア、までを自動で進めます。
          スマホなど別の画面でホームを開いておくと、場面ごとに切り替わります。アラームを1つ入れておくと夕方の提案も出ます。
          一晩は「前の記録の終わり」より後に置くので、<strong>1つのアカウントで再生できるのは1日1回</strong>が目安です（リハーサルは別のアカウントで）。
        </p>
        <div className="btn-row" role="radiogroup" aria-label="デモの速さ">
          {DEMO_SPEEDS.map((speed, i) => (
            <button
              key={speed.label}
              type="button"
              role="radio"
              aria-checked={demoSpeed === i}
              className={`btn btn-sm ${demoSpeed === i ? "btn-primary" : "btn-secondary"}`}
              disabled={!!demoStep}
              onClick={() => setDemoSpeed(i)}
            >
              {speed.label}
            </button>
          ))}
        </div>
        {demoStep ? (
          <>
            <p className="hint" aria-live="polite">
              ▶ {demoStep}
            </p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => (demoStop.current = true)}>
              止める
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary btn-sm" disabled={busy || !!session} onClick={() => void runDemo()}>
            ▶ デモを始める
          </button>
        )}
        {session && !demoStep && <p className="muted mt-2">記録中の睡眠があります。先に「4. 巣」の「巣に戻す（起床）」で終わらせてください。</p>}
      </div>

      <div className="card">
        <h2 className="card-title">🐔 1. 仮想デバイス</h2>
        <div className="row">
          <div>
            <div className="row-label">鶏 {chickenMac}</div>
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
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={makeSuggestion}>
          🌙 今夜の就寝提案を作る（evening-suggestion。ふだんは毎日19時）
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
          <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => moveEgg(false)}>
            巣から取り出す
          </button>
          <button type="button" className="btn btn-primary btn-sm" disabled={disabled} onClick={() => moveEgg(true)}>
            巣に戻す（起床）
          </button>
        </div>
        <p className="muted mt-2">
          いま：{docked ? "たまごは巣の中" : "たまごは巣の外（ベッドの上）"}。「巣に戻す」と記録が完了し、数秒でホームに朝のスコアが出ます。
        </p>
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
