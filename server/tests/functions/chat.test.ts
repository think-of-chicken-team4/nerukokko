// テキスト会話（chat.ts）と日本時間の表示（jst.ts）のテスト。実行：cd server && npm run test:functions
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calendarQueryDate,
  calendarWakeTime,
  CHAT_FALLBACK,
  CHAT_MAX_LENGTH,
  chatSystem,
  contextualChatFallback,
  toHistory,
  validateMessage,
} from "../../supabase/functions/_shared/chat.ts";
import { generateText } from "../../supabase/functions/_shared/gemini.ts";
import { formatJst, jstDateKey } from "../../supabase/functions/_shared/jst.ts";

describe("validateMessage", () => {
  it("前後の空白を除いて受け付ける", () => {
    assert.deepEqual(validateMessage("  ねむれないんだ \n"), { message: "ねむれないんだ" });
  });
  it("空・長すぎる・文字でないものは断る", () => {
    assert.ok("error" in validateMessage("   "));
    assert.ok("error" in validateMessage("あ".repeat(CHAT_MAX_LENGTH + 1)));
    assert.ok("error" in validateMessage(123));
    assert.ok("message" in validateMessage("あ".repeat(CHAT_MAX_LENGTH)));
  });
});

describe("toHistory", () => {
  it("assistant は model、それ以外は user として渡す", () => {
    assert.deepEqual(toHistory([{ role: "user", content: "こんばんは" }, { role: "assistant", content: "こんばんはコケ" }]), [
      { role: "user", text: "こんばんは" },
      { role: "model", text: "こんばんはコケ" },
    ]);
  });
});

describe("chatSystem", () => {
  it("キャラクター設定と、睡眠の情報を事実として渡す", () => {
    const system = chatSystem({
      displayName: "テスト",
      lastNight: { date: "10/16(金) 02:46", score: 96, label: "ぐっすり眠れました", turns: 20, snores: 6 },
      sleepingSince: null,
      tonight: { bedtime: "10/16(金) 23:00", reasoning: "明日の予定に間に合うコケ" },
      nextAlarm: "10/17(土) 07:15",
      calendar: {
        dateLabel: "10/18(日)",
        events: ["終日「試験」", "10/18(日) 08:00「1限」"],
        suggestedWake: "10/18(日) 06:30",
        wakeReason: "朝の準備時間を90分として",
        prepMinutes: 90,
      },
    });
    assert.ok(system.includes("コケ"));
    assert.ok(system.includes("テストさん"));
    assert.ok(system.includes("スコア 96点"));
    assert.ok(system.includes("今夜のおすすめの就寝時刻：10/16(金) 23:00"));
    assert.ok(system.includes("次のアラーム：10/17(土) 07:15"));
    assert.ok(!system.includes("試験") && !system.includes("1限"));
  });
  it("記録がない・計測なし・アラームなしも、そのまま伝える", () => {
    assert.ok(
      chatSystem({ displayName: "", lastNight: null, sleepingSince: null, tonight: null, nextAlarm: null, calendar: null }).includes(
        "睡眠の記録はまだない",
      ),
    );
    const noData = chatSystem({
      displayName: "",
      lastNight: { date: "10/16", score: null, label: null, turns: 0, snores: 0 },
      sleepingSince: "10/16(金) 23:10",
      tonight: null,
      nextAlarm: null,
      calendar: null,
    });
    assert.ok(noData.includes("スコアなし") && noData.includes("記録中") && noData.includes("アラームは未設定"));
  });
});

describe("contextualChatFallback", () => {
  const context = {
    displayName: "",
    lastNight: null,
    sleepingSince: null,
    tonight: null,
    nextAlarm: null,
    calendar: {
      dateLabel: "11/15(日)",
      events: ["終日「TOEICの試験！」", "11/15(日) 06:00「朝の準備」"],
      suggestedWake: "11/15(日) 05:00",
      wakeReason: "朝の準備時間を60分として",
      prepMinutes: 60,
    },
  };
  it("Geminiが使えなくてもカレンダーの起床質問には具体的に答える", () => {
    const reply = contextualChatFallback("Googleカレンダーを見て、何時に起きればいい？", context);
    assert.ok(reply.includes("TOEICの試験") && reply.includes("06:00") && reply.includes("05:00") && reply.includes("60分"));
  });
  it("カレンダーと関係ない質問は共通の返答", () => {
    assert.equal(contextualChatFallback("眠れない", context), CHAT_FALLBACK);
  });
});

describe("calendarQueryDate", () => {
  const now = new Date("2026-11-13T06:00:00Z"); // 11/13(金) 15:00 JST
  it("明後日と曜日を含む質問は明後日を優先する", () => {
    assert.deepEqual(calendarQueryDate("明後日の日曜の予定と起床時刻を教えて", now), { dateKey: "2026-11-15", label: "11/15(日)" });
  });
  it("曜日・月日・日付指定なしを解釈する", () => {
    assert.deepEqual(calendarQueryDate("日曜日の予定は？", now), { dateKey: "2026-11-15", label: "11/15(日)" });
    assert.deepEqual(calendarQueryDate("11月16日の予定は？", now), { dateKey: "2026-11-16", label: "11/16(月)" });
    assert.deepEqual(calendarQueryDate("カレンダーの予定は？", now), { dateKey: "2026-11-14", label: "11/14(土)" });
  });
  it("カレンダーや予定と無関係なら取得しない", () => {
    assert.equal(calendarQueryDate("よく眠れたよ", now), null);
  });
});

describe("calendarWakeTime", () => {
  const start = new Date("2026-11-14T21:00:00Z"); // 11/15 06:00 JST
  it("予定そのものが起床なら、開始時刻に起きる", () => {
    const result = calendarWakeTime("6時に起床し、風呂と朝食を済ませる", start, 60);
    assert.equal(result.wake.toISOString(), start.toISOString());
    assert.equal(result.isWakePlan, true);
  });
  it("通常の予定なら、準備時間だけ前に起きる", () => {
    const result = calendarWakeTime("TOEICの試験", start, 60);
    assert.equal(result.wake.toISOString(), "2026-11-14T20:00:00.000Z");
    assert.equal(result.isWakePlan, false);
  });
});

describe("generateText（会話の履歴）", () => {
  it("それまでの会話を古い順に渡し、最後に今回の発言を付ける", async () => {
    let sent: { contents: { role: string; parts: { text: string }[] }[] } | null = null;
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "うんうんコケ" }] } }] }));
    }) as typeof fetch;
    await generateText(
      { system: "s", prompt: "きょうはつかれた", history: [{ role: "user", text: "こんばんは" }, { role: "model", text: "こんばんはコケ" }] },
      { apiKey: "k", models: ["a"], fetchImpl },
    );
    assert.deepEqual(
      sent!.contents.map((c) => `${c.role}:${c.parts[0].text}`),
      ["user:こんばんは", "model:こんばんはコケ", "user:きょうはつかれた"],
    );
  });
});

describe("jst", () => {
  it("日本時間で表示する", () => {
    assert.equal(jstDateKey("2026-10-16T15:30:00Z"), "2026-10-17");
    assert.ok(formatJst("2026-10-16T14:00:00Z").includes("23:00"));
  });
});
