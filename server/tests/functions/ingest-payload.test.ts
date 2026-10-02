// 鶏から届くデータの検証（supabase/functions/_shared/ingest-payload.ts）のテスト
//   実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findSessionFor,
  isParseError,
  normalizeMac,
  parseIngestPayload,
  type ParsedPayload,
} from "../../supabase/functions/_shared/ingest-payload.ts";

const NOW = new Date("2026-10-01T21:05:00Z");
const ts = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();

function parseOk(body: unknown): ParsedPayload {
  const result = parseIngestPayload(body, NOW);
  if (isParseError(result)) {
    assert.fail(`エラーになった：${result.error.message}`);
  }
  return result;
}

const base = { sent_at: NOW.toISOString(), firmware_version: "chicken-0.2.0" };

describe("parseIngestPayload", () => {
  it("api-spec の例をそのまま受け付ける", () => {
    const result = parseOk({
      ...base,
      egg: { mac_address: "aa-bb-cc-dd-ee-ff", firmware_version: "egg-0.2.0", battery_level: 87 },
      environment: [{ timestamp: ts(1), temperature_c: 24.5, humidity_pct: 52, illuminance_lux: 3.2 }],
      breathing: [{ timestamp: ts(0), breaths_per_min: 14.2, source: "mmwave" }],
      motion_events: [{ timestamp: ts(1), intensity: 0.82, source: "accelerometer" }],
      audio_events: [{ timestamp: ts(1), type: "snore", duration_ms: 1200, confidence: 0.7, device: "egg" }],
      presence_events: [{ timestamp: ts(5), state: "in_bed" }],
      charge_events: [{ timestamp: ts(2), type: "charge_stop" }],
    });
    assert.equal(result.egg?.macAddress, "AA:BB:CC:DD:EE:FF");
    assert.equal(result.egg?.batteryLevel, 87);
    assert.equal(result.environment.length, 1);
    assert.equal(result.breathing[0].breathsPerMin, 14.2);
    assert.equal(result.motion_events[0].source, "accelerometer");
    assert.equal(result.audio_events[0].device, "egg");
    assert.equal(result.presence_events[0].state, "in_bed");
    assert.equal(result.charge_events[0].type, "charge_stop");
    assert.deepEqual(result.skipped, []);
  });

  it("配列は省略できる。audio_events の device は省略すると egg", () => {
    const result = parseOk({ ...base, audio_events: [{ timestamp: ts(1), type: "sleep_talk", duration_ms: 3000 }] });
    assert.equal(result.audio_events[0].device, "egg");
    assert.equal(result.audio_events[0].confidence, null);
  });

  it("範囲外・型違いの項目はスキップし、ほかは受け付ける", () => {
    const result = parseOk({
      ...base,
      environment: [
        { timestamp: ts(1), temperature_c: 24, humidity_pct: 120 },
        { timestamp: ts(2), temperature_c: 23 },
        { timestamp: ts(3) },
      ],
      breathing: [{ timestamp: ts(1), breaths_per_min: "14", source: "mmwave" }],
      motion_events: [{ timestamp: ts(1), source: "camera" }],
    });
    assert.equal(result.environment.length, 1);
    assert.deepEqual(result.skipped, [
      { kind: "environment", index: 0, reason: "invalid_value" },
      { kind: "environment", index: 2, reason: "invalid_value" },
      { kind: "breathing", index: 0, reason: "invalid_value" },
      { kind: "motion_events", index: 0, reason: "invalid_value" },
    ]);
  });

  it("48時間より前・5分より先の時刻はスキップする", () => {
    const result = parseOk({
      ...base,
      motion_events: [
        { timestamp: ts(48 * 60 + 1), source: "accelerometer" },
        { timestamp: ts(-6), source: "accelerometer" },
        { timestamp: ts(-4), source: "accelerometer" },
        { timestamp: "きのう", source: "accelerometer" },
      ],
    });
    assert.equal(result.motion_events.length, 1);
    assert.deepEqual(
      result.skipped.map((s) => s.reason),
      ["out_of_range_time", "out_of_range_time", "invalid_value"],
    );
  });

  it("sent_at・firmware_version がなければ 400", () => {
    for (const body of [{ firmware_version: "x" }, { sent_at: NOW.toISOString() }, null, []]) {
      const result = parseIngestPayload(body, NOW);
      assert.ok(isParseError(result) && result.error.status === 400);
    }
  });

  it("配列が1000件を超えたら 413", () => {
    const motion = Array.from({ length: 1001 }, () => ({ timestamp: ts(1), source: "accelerometer" }));
    const result = parseIngestPayload({ ...base, motion_events: motion }, NOW);
    assert.ok(isParseError(result) && result.error.status === 413);
  });

  it("egg の MAC アドレスが不正なら 400", () => {
    const result = parseIngestPayload({ ...base, egg: { mac_address: "xyz" } }, NOW);
    assert.ok(isParseError(result) && result.error.code === "invalid_body");
  });
});

describe("normalizeMac", () => {
  it("小文字・ハイフン区切りを大文字・コロン区切りにする", () => {
    assert.equal(normalizeMac("b8-27-eb-12-34-56"), "B8:27:EB:12:34:56");
    assert.equal(normalizeMac("B8:27:EB:12:34"), null);
  });
});

describe("findSessionFor", () => {
  const sessions = [
    { id: "a", start_time: "2026-09-30T14:00:00Z", end_time: "2026-09-30T22:00:00Z" },
    { id: "b", start_time: "2026-10-01T14:00:00Z", end_time: null },
  ];
  it("時刻を含むセッションを返す。進行中は終了なしとして扱う", () => {
    assert.equal(findSessionFor(sessions, new Date("2026-09-30T20:00:00Z"))?.id, "a");
    assert.equal(findSessionFor(sessions, new Date("2026-10-01T20:00:00Z"))?.id, "b");
    assert.equal(findSessionFor(sessions, new Date("2026-10-01T10:00:00Z")), null);
  });

  it("期間が重なるセッションがあれば、後から始まった方を選ぶ（順番によらない）", () => {
    const overlapping = [
      { id: "later", start_time: "2026-10-01T18:00:00Z", end_time: null },
      { id: "earlier", start_time: "2026-10-01T14:00:00Z", end_time: "2026-10-01T22:00:00Z" },
    ];
    assert.equal(findSessionFor(overlapping, new Date("2026-10-01T19:00:00Z"))?.id, "later");
    assert.equal(findSessionFor([...overlapping].reverse(), new Date("2026-10-01T19:00:00Z"))?.id, "later");
    assert.equal(findSessionFor(overlapping, new Date("2026-10-01T15:00:00Z"))?.id, "earlier");
  });
});
