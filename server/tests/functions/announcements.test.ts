// 鶏が話して知らせる内容の選び方（announcements.ts）のテスト。実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { type AnnouncementInput, pickAnnouncements } from "../../supabase/functions/_shared/announcements.ts";

const evening = (overrides: Partial<AnnouncementInput> = {}): AnnouncementInput => ({
  now: new Date("2026-10-16T10:30:00Z"), // 19:30 JST
  jstHour: 19,
  eveningEnabled: true,
  morningEnabled: true,
  sleeping: false,
  recommendation: { recommended_bedtime: "2026-10-16T14:35:00Z", reasoning: "23:35までに寝るのがおすすめコケ。", announced_at: null },
  lastNight: null,
  ...overrides,
});

const morning = (overrides: Partial<AnnouncementInput> = {}): AnnouncementInput => ({
  now: new Date("2026-10-16T22:20:00Z"), // 07:20 JST
  jstHour: 7,
  eveningEnabled: true,
  morningEnabled: true,
  sleeping: false,
  recommendation: null,
  lastNight: { end_time: "2026-10-16T22:16:00Z", morning_announced_at: null, comment: "おはようコケ！" },
  ...overrides,
});

describe("pickAnnouncements：夕方の就寝提案", () => {
  it("19時から就寝予定までに、まだ話していなければ話す", () => {
    assert.deepEqual(pickAnnouncements(evening()), [{ kind: "evening_suggestion", text: "23:35までに寝るのがおすすめコケ。" }]);
  });
  it("19時より前・就寝予定を過ぎた・話し済み・設定が OFF・寝ている、なら話さない", () => {
    assert.deepEqual(pickAnnouncements(evening({ jstHour: 18 })), []);
    assert.deepEqual(pickAnnouncements(evening({ now: new Date("2026-10-16T14:40:00Z"), jstHour: 23 })), []);
    assert.deepEqual(
      pickAnnouncements(evening({ recommendation: { recommended_bedtime: "2026-10-16T14:35:00Z", reasoning: "x", announced_at: "2026-10-16T10:00:00Z" } })),
      [],
    );
    assert.deepEqual(pickAnnouncements(evening({ eveningEnabled: false })), []);
    assert.deepEqual(pickAnnouncements(evening({ sleeping: true })), []);
  });
});

describe("pickAnnouncements：朝のコメント", () => {
  it("記録が終わって3時間以内に、まだ話していなければ話す", () => {
    assert.deepEqual(pickAnnouncements(morning()), [{ kind: "morning_summary", text: "おはようコケ！" }]);
  });
  it("3時間を過ぎた・話し済み・コメントがまだない・設定が OFF なら話さない", () => {
    assert.deepEqual(pickAnnouncements(morning({ now: new Date("2026-10-17T01:30:00Z"), jstHour: 10 })), []);
    assert.deepEqual(
      pickAnnouncements(morning({ lastNight: { end_time: "2026-10-16T22:16:00Z", morning_announced_at: "2026-10-16T22:17:00Z", comment: "x" } })),
      [],
    );
    assert.deepEqual(pickAnnouncements(morning({ lastNight: { end_time: "2026-10-16T22:16:00Z", morning_announced_at: null, comment: null } })), []);
    assert.deepEqual(pickAnnouncements(morning({ morningEnabled: false })), []);
  });
});
