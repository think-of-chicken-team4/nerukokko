// 鶏・たまごの状態の判定

/** 最終通信がこの時間以内ならオンラインとみなす（鶏は30秒ごとに device-sync を呼ぶ） */
export const DEVICE_ONLINE_MS = 2 * 60 * 1000;

export function isOnline(lastSeen: string | null, now: Date = new Date()): boolean {
  if (!lastSeen) {
    return false;
  }
  return now.getTime() - new Date(lastSeen).getTime() <= DEVICE_ONLINE_MS;
}

/** 鶏が device-sync で報告した最新の状態（devices.status、docs/api-spec.md §3-2） */
export type DeviceStatus = {
  alarm_ringing?: boolean;
  egg_connected?: boolean;
  egg_docked?: boolean;
  egg_battery_level?: number;
  temperature_c?: number;
  humidity_pct?: number;
  illuminance_lux?: number;
  reported_at?: string;
};

const STATUS_TYPES = {
  alarm_ringing: "boolean",
  egg_connected: "boolean",
  egg_docked: "boolean",
  egg_battery_level: "number",
  temperature_c: "number",
  humidity_pct: "number",
  illuminance_lux: "number",
  reported_at: "string",
} as const;

/** DB の jsonb から、型が合っている項目だけを取り出す */
export function parseDeviceStatus(value: unknown): DeviceStatus {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(STATUS_TYPES)
      .filter(([key, type]) => typeof raw[key] === type)
      .map(([key]) => [key, raw[key]]),
  ) as DeviceStatus;
}

/** たまごがどこにあるか。鶏の報告が古い（鶏がオフライン）ときは unknown */
export type EggPlace = "nest" | "bed" | "away" | "disconnected" | "unknown";

export function eggPlace(status: DeviceStatus, sessionActive: boolean, now: Date = new Date()): EggPlace {
  if (!isOnline(status.reported_at ?? null, now)) return "unknown";
  if (status.egg_connected === false) return "disconnected";
  if (status.egg_docked === true) return "nest";
  if (status.egg_docked === false) return sessionActive ? "bed" : "away";
  return "unknown";
}

export const EGG_PLACE_LABEL: Record<EggPlace, string> = {
  nest: "巣で充電中",
  bed: "ベッドの上（計測中）",
  away: "巣の外",
  disconnected: "鶏とつながっていません",
  unknown: "わかりません（鶏がオフライン）",
};

/** 入力された MAC アドレスを "AA:BB:CC:DD:EE:FF" にそろえる。区切りは「:」「-」かなし。形式が違えば null */
export function normalizeMacInput(input: string): string | null {
  const hex = input.trim().toUpperCase().replace(/[:-]/g, "");
  if (!/^[0-9A-F]{12}$/.test(hex)) return null;
  return hex.match(/.{2}/g)!.join(":");
}
