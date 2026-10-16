// ingest-sensor-data に届く JSON の検証（docs/api-spec.md §3-1）。
// DB に依存しない純粋な関数なので、Node のテスト（server/tests/functions/）からも直接呼べる。
// 不正な値の項目はスキップして skipped に入れ、ほかの項目は受け付ける。

export const INGEST_LIMITS = {
  maxItemsPerArray: 1000,
  /** これより古い計測時刻は受け付けない */
  pastWindowMs: 48 * 60 * 60 * 1000,
  /** これより先の計測時刻は受け付けない（鶏の時計のずれを考慮） */
  futureWindowMs: 5 * 60 * 1000,
} as const;

export const ITEM_KINDS = [
  "environment",
  "breathing",
  "motion_events",
  "audio_events",
  "presence_events",
  "charge_events",
] as const;

export type ItemKind = (typeof ITEM_KINDS)[number];
export type SkipReason = "no_session" | "invalid_value" | "out_of_range_time" | "duplicate";
export type Skipped = { kind: ItemKind; index: number; reason: SkipReason };

type Base = { index: number; time: Date };
export type EnvironmentItem = Base & {
  temperatureC: number | null;
  humidityPct: number | null;
  illuminanceLux: number | null;
};
export type BreathingItem = Base & { breathsPerMin: number; source: "mmwave" | "mic" };
export type MotionItem = Base & { intensity: number | null; source: "accelerometer" | "mmwave" };
export type AudioItem = Base & {
  type: "snore" | "sleep_talk";
  durationMs: number;
  confidence: number | null;
  device: "egg" | "chicken";
};
export type PresenceItem = Base & { state: "in_bed" | "out_of_bed" };
export type ChargeItem = Base & { type: "charge_start" | "charge_stop" };

export type EggInfo = { macAddress: string; firmwareVersion: string | null; batteryLevel: number | null };

export type ParsedPayload = {
  sentAt: Date;
  firmwareVersion: string;
  egg: EggInfo | null;
  environment: EnvironmentItem[];
  breathing: BreathingItem[];
  motion_events: MotionItem[];
  audio_events: AudioItem[];
  presence_events: PresenceItem[];
  charge_events: ChargeItem[];
  skipped: Skipped[];
};

export type ParseError = { error: { status: 400 | 413; code: string; message: string } };

const MAC_PATTERN = /^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/;

/** MAC アドレスを大文字・コロン区切りにそろえる。形式が違えば null */
export function normalizeMac(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const mac = value.trim().toUpperCase().replaceAll("-", ":");
  return MAC_PATTERN.test(mac) ? mac : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTime(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time;
}

/** 数値の範囲チェック。undefined/null は null（省略）、範囲外・型違いは undefined（不正） */
function optionalNumber(value: unknown, min: number, max: number): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) return undefined;
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export function isParseError(value: ParsedPayload | ParseError): value is ParseError {
  return "error" in value;
}

export function parseIngestPayload(body: unknown, now: Date): ParsedPayload | ParseError {
  if (!isRecord(body)) {
    return { error: { status: 400, code: "invalid_body", message: "JSON のオブジェクトを送ってください" } };
  }
  const sentAt = parseTime(body.sent_at);
  if (!sentAt) {
    return { error: { status: 400, code: "invalid_body", message: "sent_at（ISO 8601 の時刻）が必要です" } };
  }
  if (typeof body.firmware_version !== "string" || body.firmware_version.length === 0) {
    return { error: { status: 400, code: "invalid_body", message: "firmware_version が必要です" } };
  }

  for (const kind of ITEM_KINDS) {
    const items = body[kind];
    if (items !== undefined && !Array.isArray(items)) {
      return { error: { status: 400, code: "invalid_body", message: `${kind} は配列で送ってください` } };
    }
    if (Array.isArray(items) && items.length > INGEST_LIMITS.maxItemsPerArray) {
      return {
        error: {
          status: 413,
          code: "payload_too_large",
          message: `${kind} は1回に${INGEST_LIMITS.maxItemsPerArray}件までです。分けて送ってください`,
        },
      };
    }
  }

  let egg: EggInfo | null = null;
  if (body.egg !== undefined && body.egg !== null) {
    const macAddress = isRecord(body.egg) ? normalizeMac(body.egg.mac_address) : null;
    if (!isRecord(body.egg) || !macAddress) {
      return { error: { status: 400, code: "invalid_body", message: "egg.mac_address（AA:BB:CC:DD:EE:FF）が必要です" } };
    }
    const battery = optionalNumber(body.egg.battery_level, 0, 100);
    egg = {
      macAddress,
      firmwareVersion: typeof body.egg.firmware_version === "string" ? body.egg.firmware_version : null,
      batteryLevel: battery === undefined ? null : battery === null ? null : Math.round(battery),
    };
  }

  const result: ParsedPayload = {
    sentAt,
    firmwareVersion: body.firmware_version,
    egg,
    environment: [],
    breathing: [],
    motion_events: [],
    audio_events: [],
    presence_events: [],
    charge_events: [],
    skipped: [],
  };

  const earliest = now.getTime() - INGEST_LIMITS.pastWindowMs;
  const latest = now.getTime() + INGEST_LIMITS.futureWindowMs;

  // 各配列の項目を1件ずつ検証する。build が null を返したら不正な値としてスキップ
  const each = <T>(kind: ItemKind, build: (raw: Record<string, unknown>, base: Base) => T | null, out: T[]) => {
    const items = (body[kind] as unknown[] | undefined) ?? [];
    items.forEach((raw, index) => {
      if (!isRecord(raw)) {
        result.skipped.push({ kind, index, reason: "invalid_value" });
        return;
      }
      const time = parseTime(raw.timestamp);
      if (!time) {
        result.skipped.push({ kind, index, reason: "invalid_value" });
        return;
      }
      if (time.getTime() < earliest || time.getTime() > latest) {
        result.skipped.push({ kind, index, reason: "out_of_range_time" });
        return;
      }
      const item = build(raw, { index, time });
      if (item === null) {
        result.skipped.push({ kind, index, reason: "invalid_value" });
        return;
      }
      out.push(item);
    });
  };

  each<EnvironmentItem>(
    "environment",
    (raw, base) => {
      const temperatureC = optionalNumber(raw.temperature_c, -20, 60);
      const humidityPct = optionalNumber(raw.humidity_pct, 0, 100);
      const illuminanceLux = optionalNumber(raw.illuminance_lux, 0, 99999);
      if (temperatureC === undefined || humidityPct === undefined || illuminanceLux === undefined) return null;
      if (temperatureC === null && humidityPct === null && illuminanceLux === null) return null;
      return { ...base, temperatureC, humidityPct, illuminanceLux };
    },
    result.environment,
  );

  each<BreathingItem>(
    "breathing",
    (raw, base) => {
      const breathsPerMin = optionalNumber(raw.breaths_per_min, 0, 60);
      const source = oneOf(raw.source, ["mmwave", "mic"] as const);
      if (breathsPerMin === undefined || breathsPerMin === null || !source) return null;
      return { ...base, breathsPerMin, source };
    },
    result.breathing,
  );

  each<MotionItem>(
    "motion_events",
    (raw, base) => {
      const intensity = optionalNumber(raw.intensity, 0, 999.99);
      const source = oneOf(raw.source, ["accelerometer", "mmwave"] as const);
      if (intensity === undefined || !source) return null;
      return { ...base, intensity, source };
    },
    result.motion_events,
  );

  each<AudioItem>(
    "audio_events",
    (raw, base) => {
      const type = oneOf(raw.type, ["snore", "sleep_talk"] as const);
      const durationMs = optionalNumber(raw.duration_ms, 1, 600000);
      const confidence = optionalNumber(raw.confidence, 0, 1);
      const device = raw.device === undefined ? "egg" : oneOf(raw.device, ["egg", "chicken"] as const);
      if (!type || durationMs === undefined || durationMs === null || confidence === undefined || !device) return null;
      return { ...base, type, durationMs: Math.round(durationMs), confidence, device };
    },
    result.audio_events,
  );

  each<PresenceItem>(
    "presence_events",
    (raw, base) => {
      const state = oneOf(raw.state, ["in_bed", "out_of_bed"] as const);
      return state ? { ...base, state } : null;
    },
    result.presence_events,
  );

  each<ChargeItem>(
    "charge_events",
    (raw, base) => {
      const type = oneOf(raw.type, ["charge_start", "charge_stop"] as const);
      return type ? { ...base, type } : null;
    },
    result.charge_events,
  );

  return result;
}

/**
 * 計測時刻を含む睡眠セッションを探す（開始 ≦ 時刻 ≦ 終了。進行中なら終了なし）。
 * 期間が重なるセッションがあれば（デバイスシミュレーターで過去にさかのぼって作った場合など）、後から始まった方を選ぶ。
 */
export function findSessionFor<T extends { start_time: string; end_time: string | null }>(
  sessions: T[],
  time: Date,
): T | null {
  const t = time.getTime();
  let found: T | null = null;
  for (const s of sessions) {
    const start = new Date(s.start_time).getTime();
    const end = s.end_time ? new Date(s.end_time).getTime() : Number.POSITIVE_INFINITY;
    if (start <= t && t <= end && (!found || start > new Date(found.start_time).getTime())) {
      found = s;
    }
  }
  return found;
}
