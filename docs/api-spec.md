# ねるコッコ API仕様書（鶏・Webアプリ ⇔ サーバー）

- 版：v0.1（ドラフト。組み込み担当と合意したら v1.0 にする）
- 最終更新：2026-09-24　作成：田村（Claude Code と作成）
- 関連：`docs/ble-protocol.md`（鶏⇔たまご）、`server/supabase/migrations/`（DBスキーマ）、`docs/dev-plan.md`

この文書は、**鶏ユニット（Raspberry Pi）・Webアプリとサーバー（Supabase）の間の通信の契約**です。
どちらかの実装を変える前にこの文書を更新し、相手側の担当者に知らせてください（`CLAUDE.md` §3）。

---

## 1. 共通ルール

### 1-1. エンドポイント

すべて Supabase Edge Functions です。

| 環境 | ベースURL |
|---|---|
| 本番 | `https://<プロジェクトID>.supabase.co/functions/v1/<関数名>` |
| ローカル開発 | `http://127.0.0.1:54321/functions/v1/<関数名>` |

### 1-2. 形式

- リクエスト・レスポンスは JSON（UTF-8）。音声だけは例外（§3-3）。
- 時刻は ISO 8601 の UTC（例：`2026-10-01T15:04:05.123Z`）。ミリ秒まで送ってよい。
- 画面表示とアラームの時刻は日本時間（`Asia/Tokyo`）で扱う。`alarms.time` は日本時間の時刻。

### 1-3. 認証

| 呼び出し元 | ヘッダー | 説明 |
|---|---|---|
| 鶏ユニット | `apikey: <publishable キー>`<br>`x-device-token: <デバイストークン>` | publishable キーは公開してよい値。デバイストークンは鶏1台ごとの秘密の値（§2） |
| Webアプリ（ログイン中のユーザー） | `Authorization: Bearer <アクセストークン>` | supabase-js の `functions.invoke()` が自動で付ける |
| サーバー内部・定期実行 | `apikey: <secret キー>` | secret キーはサーバーの外に出さない |

**鶏ユニットに secret キー（旧 service_role キー）を置いてはいけない。** 全ユーザーのデータを読み書きできてしまうため。

### 1-4. エラー

```json
{ "error": { "code": "invalid_token", "message": "デバイストークンが正しくありません" } }
```

| HTTP | code の例 | 意味 | 鶏の動作 |
|---|---|---|---|
| 400 | `invalid_json` / `invalid_body` | 形式が正しくない | 送信データを捨てる（再送しても直らない） |
| 401 | `missing_token` / `invalid_token` | 認証に失敗 | 再送しない。ログに出してトークンの設定を確認する |
| 404 | `device_not_found` | デバイスが未登録 | 同上 |
| 413 | `payload_too_large` | データが大きすぎる | 分割して送る |
| 429 | `rate_limited` | 送信が多すぎる | 60秒待って再送 |
| 500 / 502 / 503 | `internal_error` など | サーバー側の障害 | データを手元に残し、間隔を空けて再送（最大24時間分） |

### 1-5. 再送と重複

鶏は、送信に失敗したデータを手元に残して再送してよい。サーバーは「同じデバイス・同じ時刻・同じ種類」のデータを重複として無視する（DBの一意制約）。
そのため、**1件ごとの `timestamp` は計測したときの時刻を入れ、再送時に付け直さない**こと。

---

## 2. デバイスの登録とトークン

1. ユーザーが Webアプリの「デバイス」画面で鶏の MAC アドレスを入力し、「登録」を押す。
2. Webアプリが RPC `register_device`（§4-2）を呼ぶ。サーバーは**デバイストークンを1回だけ表示用に返し**、DB にはハッシュ（SHA-256）だけを保存する。
3. ユーザーが表示されたトークンを、鶏の `.env` の `DEVICE_TOKEN` に書く。
4. たまごは登録不要。鶏が送るデータに含まれる `egg.mac_address` を見て、サーバーが同じユーザーのたまごとして自動で登録する。

同じ鶏をもう一度登録するとトークンが作り直され、古いトークンは使えなくなる（紛失時の再発行）。
別の MAC アドレスで登録すると、そのユーザーの鶏（またはたまご）の MAC アドレスが置き換わる（機体の交換。これまでの計測データは残る）。

**鶏の `.env`（例）**

```bash
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxx
DEVICE_TOKEN=（登録時に表示された値）
```

---

## 3. 鶏 → サーバー

### 3-1. `POST ingest-sensor-data` — 計測データの送信

**送るタイミング**

- 通常：60秒ごとに、その間にたまった計測値とイベントをまとめて送る。
- **即時**：たまごの充電開始・停止（Dock Event）を受け取ったら、60秒を待たずにすぐ送る（起床処理のため）。

**リクエスト例**

```json
{
  "sent_at": "2026-10-01T21:05:00.000Z",
  "firmware_version": "chicken-0.2.0",
  "egg": {
    "mac_address": "AA:BB:CC:DD:EE:FF",
    "firmware_version": "egg-0.2.0",
    "battery_level": 87
  },
  "environment": [
    { "timestamp": "2026-10-01T21:04:30.000Z", "temperature_c": 24.5, "humidity_pct": 52.0, "illuminance_lux": 3.2 }
  ],
  "breathing": [
    { "timestamp": "2026-10-01T21:05:00.000Z", "breaths_per_min": 14.2, "source": "mmwave" }
  ],
  "motion_events": [
    { "timestamp": "2026-10-01T21:04:12.340Z", "intensity": 0.82, "source": "accelerometer" }
  ],
  "audio_events": [
    { "timestamp": "2026-10-01T21:04:40.000Z", "type": "snore", "duration_ms": 1200, "confidence": 0.70, "device": "egg" }
  ],
  "presence_events": [
    { "timestamp": "2026-10-01T21:00:03.000Z", "state": "in_bed" }
  ],
  "charge_events": [
    { "timestamp": "2026-10-01T21:03:59.000Z", "type": "charge_stop" }
  ]
}
```

**項目**（配列はどれも省略可・空配列可。1配列あたり最大1000件）

| 項目 | 型 | 必須 | 範囲・説明 |
|---|---|---|---|
| `sent_at` | 時刻 | ○ | 送信した時刻 |
| `firmware_version` | 文字列 | ○ | 鶏の Python アプリのバージョン |
| `egg` | オブジェクト | — | たまごと BLE でつながっている（または一度でもつながった）ときに付ける |
| `egg.mac_address` | 文字列 | ○（`egg` があれば） | `AA:BB:CC:DD:EE:FF` 形式 |
| `egg.firmware_version` | 文字列 | — | |
| `egg.battery_level` | 整数 | — | 0〜100。現状は BLE で送っていないので省略してよい |
| `environment[]` | | | 鶏本体の温湿度・照度（環境センサーは鶏に搭載と決定） |
| `.temperature_c` / `.humidity_pct` / `.illuminance_lux` | 数値 | 1つ以上 | −20〜60 ℃ / 0〜100 % / 0〜99999 lx。読めなかった値は `null` か省略 |
| `breathing[]` | | | 呼吸数（1分に1件程度） |
| `.breaths_per_min` | 数値 | ○ | 0〜60 |
| `.source` | 文字列 | ○ | `mmwave`（鶏のレーダー）または `mic` |
| `motion_events[]` | | | **寝返り1回につき1件**（§6-1） |
| `.intensity` | 数値 | — | 加速度の変化量（g 単位、0〜999.99） |
| `.source` | 文字列 | ○ | `accelerometer`（たまご）または `mmwave`（鶏） |
| `audio_events[]` | | | **いびき・寝言1回につき1件**（§6-2） |
| `.type` | 文字列 | ○ | `snore` または `sleep_talk` |
| `.duration_ms` | 整数 | ○ | 1〜600000 |
| `.confidence` | 数値 | — | 0.00〜1.00 |
| `.device` | 文字列 | — | どちらのマイクで検出したか。`egg`（既定）または `chicken` |
| `presence_events[]` | | | 在床状態が変わったときだけ送る |
| `.state` | 文字列 | ○ | `in_bed` または `out_of_bed` |
| `charge_events[]` | | | たまごの Dock Event |
| `.type` | 文字列 | ○ | `charge_start`（巣に戻った＝起床）または `charge_stop`（巣から離れた） |

**サーバーの処理**

- どのデバイスのデータとして保存するか：`environment`・`breathing`・`presence_events`・`source = mmwave` の寝返りは鶏、`source = accelerometer` の寝返り・`charge_events` はたまご、`audio_events` は `device` の値。
- どの睡眠セッションに入れるか：1件ごとの `timestamp` が、そのユーザーの睡眠セッションの期間（開始〜終了、進行中なら現在まで）に入っていれば、そのセッションに保存する。**どのセッションにも入らない計測値は保存せずにスキップする**（寝ていない時間のデータは記録しない）。`charge_events` はセッション外でも保存する。
- **`charge_start` を受け取ったとき、進行中のセッションがあれば、それを完了にする**（`end_time`・`actual_wake_time` をその時刻に、`status` を `completed` に）。続けて朝の振り返り（スコア算出とコメント生成）をバックグラウンドで実行する。
- 不正な値の項目はスキップして、レスポンスの `skipped` で知らせる（ほかの項目は保存する）。
- 鶏・たまごの `last_seen`（最終通信時刻）と、たまごのバッテリー残量を更新する。

**レスポンス例（200）**

```json
{
  "accepted": { "environment": 1, "breathing": 1, "motion_events": 1, "audio_events": 1, "presence_events": 1, "charge_events": 1 },
  "skipped": [ { "kind": "motion_events", "index": 3, "reason": "no_session" } ],
  "session": { "id": "7f0c…", "status": "in_progress" }
}
```

`skipped[].reason`：`no_session`（期間外）、`invalid_value`（範囲外・型違い）、`out_of_range_time`（48時間より前、または5分より先の時刻）、`duplicate`（重複）

### 3-2. `POST device-sync` — 状態の報告と設定の取得

**送るタイミング**：起動直後と、その後30秒ごと。

**リクエスト例**

```json
{
  "firmware_version": "chicken-0.2.0",
  "egg_mac_address": "AA:BB:CC:DD:EE:FF",
  "status": {
    "alarm_ringing": false,
    "egg_connected": true,
    "egg_docked": false,
    "egg_battery_level": 87,
    "temperature_c": 24.1,
    "humidity_pct": 51.0,
    "illuminance_lux": 120.0
  }
}
```

`status` の各項目は分からなければ省略してよい。サーバーはこれを「デバイス」画面の表示用に保存する。

**レスポンス例（200）**

```json
{
  "server_time": "2026-10-01T12:00:00.000Z",
  "alarm": { "ring_at": "2026-10-01T22:30:00.000Z", "source": "session", "alarm_id": null },
  "session": {
    "id": "7f0c…",
    "status": "in_progress",
    "start_time": "2026-10-01T14:10:00.000Z",
    "planned_wake_time": "2026-10-01T22:30:00.000Z"
  },
  "settings": { "character_voice": "rooster" }
}
```

| 項目 | 説明 |
|---|---|
| `alarm` | 次に鳴らす時刻。進行中のセッションがあればその `planned_wake_time`（`source: "session"`）、なければ有効なアラームのうち次に来る時刻（`source: "alarm"`、7日以内）。どちらもなければ `null` |
| `session` | 進行中の睡眠セッション。なければ `null` |
| `settings.character_voice` | `rooster`（にわとり）または `chick`（ひよこ） |

**鶏の動作**

- `alarm.ring_at` になったら鳴らす（LED＋コケコッコー）。**在床の確認はしない。**
- 最後に受け取った `alarm` は手元に保存しておき、Wi-Fi が切れていても鳴らせるようにする。
- たまごが巣に戻った（Dock Event の `docked = 1`）ら、**サーバーを待たずにその場でアラームを止め**、`ingest-sensor-data` で `charge_start` をすぐ送る。
- 安全のため、最大30分鳴ったら止める（値は設定で変えられるようにする）。

### 3-3. `POST voice-chat` — 音声会話

トサカボタンが押されたら、録音して送る。

**リクエスト**

```
POST /functions/v1/voice-chat?chat_session_id=<前回のID（続けて話すとき）>
apikey: <publishable キー>
x-device-token: <デバイストークン>
Content-Type: audio/wav

（WAV のバイナリ：PCM 16bit・モノラル・16kHz、最大15秒・512KB）
```

**レスポンス例（200）**

```json
{
  "chat_session_id": "c1d2…",
  "user_text": "きょうはつかれた",
  "reply_text": "おつかれさまコケ！今夜は早めに寝て、しっかり休もうコケ。",
  "audio": { "mime_type": "audio/wav", "base64": "UklGR…" },
  "fallback": false
}
```

- `chat_session_id` を省略するか、最後の発言から10分以上たっている場合は、新しい会話として扱う。
- 聞き取れなかったときや AI の障害時も **200 を返し**、`fallback: true` と定型の返答（例：「もう一回言ってほしいコケ」）を返す。
- `audio` が `null` のときは、鶏に保存してある定型音声を再生する。
- 返す音声は WAV（PCM 16bit・モノラル・24kHz）。音声認識・合成に使う API は未決（`docs/dev-plan.md` §9 Q5）だが、この形式は変えない。

---

## 4. Webアプリ → サーバー

### 4-1. supabase-js で直接読み書きするもの

RLS によって、ログイン中のユーザー自身のデータにしかアクセスできない。

| テーブル | 読む | 書く |
|---|---|---|
| `users` | ○ | 更新（`display_name`） |
| `devices` | ○ | ×（登録・付け替えは RPC `register_device`。削除すると計測データも消えるため、削除はできない） |
| `sleep_sessions` | ○ | 追加（「眠りにつく」）、更新（中止・起床時刻の変更） |
| 計測系（`environment_readings` など6テーブル） | ○ | ×（デバイスからのみ） |
| `alarms` | ○ | 追加・更新・削除 |
| `sleep_recommendations` | ○ | × |
| `chat_sessions` / `chat_messages` | ○ | ×（`chat` 関数経由） |
| `notification_settings` | ○ | 更新 |

**睡眠セッションを始める（「眠りにつく」）**

```ts
await supabase.from("sleep_sessions").insert({
  user_id: user.id,
  start_time: new Date().toISOString(),
  planned_wake_time: nextAlarmAt.toISOString(),
  status: "in_progress",
});
```

進行中のセッションは1ユーザーにつき1つまで（2つ目は DB がエラーを返す）。中止は `status: "aborted"` と `end_time` を更新する。

### 4-2. RPC `register_device` — デバイスの登録

```ts
const { data, error } = await supabase.rpc("register_device", {
  p_type: "chicken",
  p_mac_address: "B8:27:EB:12:34:56",
});
// data: [{ device_id: "…", device_token: "…" }]  ← device_token はこのときだけ表示する
```

たまごを手動で登録するときは `p_type: "egg"`（`device_token` は `null`）。

### 4-3. `POST chat` — テキスト会話

```ts
const { data } = await supabase.functions.invoke("chat", {
  body: { message: "最近ねむれないんだ", chat_session_id: "…（続けて話すとき）" },
});
// data: { chat_session_id: "…", reply: "…", fallback: false }
```

- `message` は1〜500文字。
- サーバーは、直近の睡眠データ・今夜の就寝提案・この会話の直近10件を AI に渡して返答を作り、`chat_messages` に保存する。

### 4-4. `POST morning-summary` — 朝の振り返りの再計算

通常は `charge_start` を受けたときにサーバーが自動で実行する。Webアプリやデモから手動でやり直すときに使う。

```ts
await supabase.functions.invoke("morning-summary", { body: { session_id: "…" } });
// data: { session_id, score, label, details: { efficiency: 88, turn_balance: 90, … }, comment }
```

### 4-5. `POST evening-suggestion` — 就寝時刻の提案

- 毎日19:00（日本時間）に、サーバーの定期実行が secret キーで呼び、全ユーザーぶん作る。
- Webアプリから呼ぶと、ログイン中のユーザーの分だけ作り直す（デモ用）。

```ts
const { data } = await supabase.functions.invoke("evening-suggestion", { body: {} });
// data: { recommendation: { target_date, recommended_bedtime, recommended_wake_time, required_sleep_minutes, reasoning } }
```

### 4-6. Realtime（画面の自動更新）

| 画面 | 購読するテーブル | 絞り込み |
|---|---|---|
| 睡眠中 | `motion_events`・`audio_events`・`environment_readings`・`breathing_readings` | `session_id=eq.<進行中のセッションID>` |
| ホーム全体 | `sleep_sessions` | `user_id=eq.<ユーザーID>`（起床・スコア確定の検知） |
| にわとりチャット | `chat_messages` | `chat_session_id=eq.<会話ID>` |

---

## 5. サーバー内部の処理

- **起床〜朝の振り返り**：`ingest-sensor-data` が `charge_start` を受ける → セッションを完了 → `morning-summary` をバックグラウンドで実行 → スコア（`sleep_sessions.score`・`score_details`）とにわとりのコメント（`chat_sessions.trigger = 'scheduled_morning'`）を保存 → Realtime で Webアプリに反映。
- **夕方の提案**：Supabase Cron が毎日 10:00 UTC（＝19:00 日本時間）に `evening-suggestion` を呼ぶ。
- スコアの計算方法は `docs/dev-plan.md` §6。

---

## 6. 鶏側の判定方法（初期案・組み込み担当向けの参考）

API は「判定済みのイベント」を受け取る。判定方法は実機のデータを見て自由に調整してよい。

### 6-1. 寝返り

- たまごの Motion Event（しきい値を超えたときの Notify）を受け取ったら「動きあり」とする。
- 10秒以内に続いた「動きあり」は、まとめて**寝返り1回**とする（その最初の時刻を `timestamp` にする）。
- `intensity` は、その10秒間の加速度変化量の最大値（g 単位）。MPU-6050 を ±2g で使う場合は 16384 LSB＝1g。

### 6-2. いびき・寝言

- たまごの Audio Level（約0.3秒ごと）と鶏のマイクの音量を使う。
- 直近60秒の音量の中央値を「背景の音量」とし、その3倍を超えた区間を「大きな音」とする。
- 「大きな音」が 0.3〜3秒の長さで、2〜6秒の間隔で3回以上くり返したら**いびき**（`duration_ms` はくり返しの全体の長さ）。
- くり返しのない「大きな音」が1秒以上続いたら**寝言**。
- `confidence` は、くり返しの間隔がそろっているほど高くする（目安）。

### 6-3. 呼吸・在床

- 呼吸：A111 の呼吸数を1分ごとにまとめ（中央値）、1件送る（`source: "mmwave"`）。
- 在床：A111 で人を検知できる／できない状態が1分以上続いたら、状態の変化として送る。

---

## 7. DB の変更点（`docs/software-spec.md` ver4 との差分）

API を実装するために、次の変更を加える（`server/supabase/migrations/` が正）。

| テーブル | 変更 | 理由 |
|---|---|---|
| `users` | `id` を `auth.users.id` と同じ値にする（外部キー） | Supabase Auth と紐付けるため |
| `devices` | `status`（jsonb、最新の状態報告）を追加。`firmware_version` の既定値を `'unknown'` に。1ユーザーにつき鶏・たまご各1台の一意制約 | デバイス画面の表示、登録を簡単にするため |
| `device_tokens`（新規） | デバイストークンのハッシュを保存。Webアプリからは読めない | 鶏の認証のため |
| `sleep_sessions` | `chicken_device_id`・`egg_device_id` を NULL 可に。`score_details`（jsonb）を追加。進行中は1ユーザー1件まで | たまご未接続でも記録を始められるように、スコアの内訳を表示するため |
| 計測系6テーブル | 「デバイス＋時刻＋種類」の一意制約 | 再送時の重複を防ぐため |
| `sleep_recommendations` | `recommended_wake_time`・`first_event_title`・`first_event_start` を追加 | 夕方確認の画面に「明日の予定」と「起きる時刻」を出すため |
| `chat_sessions` | `trigger` に `'app'`（Webアプリのテキスト会話）を追加 | |
| （T-205で追加予定） | `google_credentials`：カレンダー用のトークン | |

---

## 8. 変更履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v0.1 | 2026-09-24 | 初版（ドラフト） |
