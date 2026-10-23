# クラウドの準備と公開の手順（田村さん向け）

最終更新：2026-10-17　作成：田村（Claude Code と作成）

アカウントの作成と、秘密の値（キー・シークレット）の入力は**人（田村さん）が行う**手順です。Claude はアカウントを作ったり、キーを入力したりしません。
**どのサービスも無料の範囲で使い、クレジットカードは登録しない**（決定ログ 2026-10-16）。途中で「お支払い情報」「請求先アカウント」を求められたら、そこで止めて相談してください。

| § | やること | いつ | 必要なもの |
|---|---|---|---|
| 1 | Gemini の API キー | 済み（10/16） | Google アカウント |
| 2 | ローカルでカレンダー連携を試す | **いつでも（T-205 の確認）** | Google アカウント |
| 3 | Google Cloud の OAuth クライアント（カレンダー連携） | §2 と同時 | Google アカウント |
| 4 | Supabase のクラウドのプロジェクト | 公開の準備（ステップ6） | GitHub アカウント |
| 5 | Vercel（Webアプリの公開） | 公開の準備（ステップ6） | GitHub アカウント |
| 6 | 公開したあとの設定（Google・鶏） | §4・§5 のあと | |

秘密の値は、**Git・Issue・PR・チャットに貼らない**（リポジトリは PUBLIC）。入れる場所は、ローカルなら `server/supabase/functions/.env`、本番なら `npx supabase secrets set`（Supabase）と Vercel の環境変数だけです。

---

## 1. Gemini の API キー（済み）

- Google AI Studio →「Get API key」で作ったキー（`AQ.` で始まる）を、`server/supabase/functions/.env` の `GEMINI_API_KEY` に入れてある。
- 本番では §4 の手順で `npx supabase secrets set` する。

## 2. ローカルでカレンダー連携を試す（T-205 の確認）

§3 で OAuth クライアントを作ったら、ローカルで本物の Google カレンダーとつないで確かめます。

1. `server/supabase/functions/.env` に、§3 でメモした値を書き足す（`.env.example` に名前がある）。
   ```
   GOOGLE_CLIENT_ID=（§3 のクライアント ID）
   GOOGLE_CLIENT_SECRET=（§3 のクライアント シークレット）
   ```
   `GOOGLE_REDIRECT_URIS` は空のままでよい（ローカルの `http://localhost:3000/settings/calendar/callback` になる）。
2. `npx supabase functions serve` を止めて、起動し直す（`.env` は起動したときにだけ読まれる）。
3. Webアプリ（http://localhost:3000 。**`127.0.0.1` ではなく `localhost` で開く**）→ 設定 →「📅 カレンダー連携」→「Googleカレンダーと連携する」。
4. Google の画面で、§3 の「テストユーザー」に入れたアカウントを選ぶ。「このアプリは Google で確認されていません」と出たら「続行」。カレンダーの項目にチェックを入れて「続行」。
5. 設定画面に戻り、「連携しました」「連携中」と出れば成功。
6. Google カレンダーに、明日の朝（アラームより早い時刻。例：アラームが 7:15 なら 8:00 の予定）に予定を1つ入れる。
7. デバイスシミュレーター（設定 →「デバイスシミュレーターを開く」）の「🌙 今夜の就寝提案を作る」を押す。ホームの夕方の画面に「明日の予定」が出て、起きる時刻が「予定の90分前」、理由文に「アラームを早める」とあれば成功。

うまくいかないとき：設定画面の赤い文字と、`functions serve` のターミナルの `calendar (…) failed` の行を Claude に見せてください（トークンは表示されません）。

## 3. Google Cloud の OAuth クライアント（カレンダー連携）

Google Cloud のプロジェクトを作るだけなら、請求先アカウント（クレジットカード）は不要です。Google Calendar API も無料で使えます。

1. https://console.cloud.google.com/ を開き、上の「プロジェクトを選択」→「新しいプロジェクト」。名前は `nerukokko` など。**請求先アカウントは設定しない**。
2. 「API とサービス」→「ライブラリ」で **Google Calendar API** を探して「有効にする」。
3. 「Google Auth Platform」（「OAuth 同意画面」）を開き、「開始」を押して次を入れる。
   - アプリ名：`ねるコッコ`、ユーザーサポートメール：自分のアドレス
   - 対象（Audience）：**外部**
   - 連絡先メール：自分のアドレス
4. 「対象」（Audience）の「テストユーザー」に、連携を試す Google アカウント（田村さん、デモで使う人）を追加する（100人まで）。**公開ステータスは「テスト中」のままにする**（「本番環境」にすると Google の審査が必要になる）。
5. 「データアクセス」→「スコープを追加または削除」で、`https://www.googleapis.com/auth/calendar.readonly`（カレンダーの予定の表示）を追加して保存する。
6. 「クライアント」→「クライアントを作成」。
   - アプリケーションの種類：**ウェブ アプリケーション**、名前：`nerukokko-web`
   - 承認済みのリダイレクト URI：`http://localhost:3000/settings/calendar/callback`（公開したら §6 で本番の URL も足す）
   - 「承認済みの JavaScript 生成元」は空でよい
7. 作成すると「クライアント ID」と「クライアント シークレット」が出るので、§2 の `.env` に入れる（**シークレットは一度しか表示されないことがある**ので、その場で `.env` に入れる。チャットには貼らない）。

注意：
- 「テスト中」のアプリでは、**連携が7日で切れる**（Google の決まり）。切れると、ねるコッコの設定画面が「連携していない」に戻るので、もう一度「連携する」を押す。発表の前日に連携し直すと安全。
- テストユーザーに入っていないアカウントでは連携できない（「アクセスをブロック」と出る）。

## 4. Supabase のクラウドのプロジェクト（公開の準備）

無料プランで作ります（2プロジェクトまで。**1週間アクセスがないと一時停止する**ので、そのときはダッシュボードで「Restore」する）。

1. https://supabase.com/dashboard に GitHub アカウントでログインし、「New project」。Organization の Plan は **Free**。名前 `nerukokko`、Region は **Northeast Asia (Tokyo)**、データベースのパスワードは自分で作って安全な場所に保存する。
2. プロジェクトの「Project Settings」→「General」の **Reference ID** をメモする（秘密ではない）。
3. 手元で DB と関数をクラウドに入れる（`server/` で実行。途中でデータベースのパスワードを聞かれる）。
   ```bash
   cd server
   npx supabase login
   npx supabase link --project-ref <Reference ID>
   npx supabase db push
   npx supabase functions deploy
   ```
4. 関数の秘密の値を入れる（値はターミナルに直接打つ。チャットに貼らない）。
   ```bash
   npx supabase secrets set GEMINI_API_KEY=<Gemini のキー>
   npx supabase secrets set GOOGLE_CLIENT_ID=<§3 の ID> GOOGLE_CLIENT_SECRET=<§3 のシークレット>
   ```
   `GOOGLE_REDIRECT_URIS` は §5 で Vercel の URL が決まってから入れる（§6）。
5. 定期実行（記録の自動締め・夕方の提案）のために、ダッシュボードの「SQL Editor」で次を実行する。secret キーは「Project Settings」→「API Keys」の **secret** キー（`sb_secret_…`）。
   ```sql
   select vault.create_secret('https://<Reference ID>.supabase.co', 'project_url');
   select vault.create_secret('<secret キー>', 'secret_key');
   ```
6. 「Authentication」→「URL Configuration」の Site URL に、§5 の Vercel の URL を入れる（決まってから）。
7. Webアプリに入れる値をメモする：Project URL（`https://<Reference ID>.supabase.co`）と **publishable** キー（`sb_publishable_…`。公開してよい値）。

## 5. Vercel（Webアプリの公開）

Hobby プラン（無料）で作ります。

1. https://vercel.com に GitHub アカウントでログインし、「Add New…」→「Project」→ `think-of-chicken-team4/nerukokko` を Import する（組織のリポジトリが出ないときは、GitHub 側で Vercel のアクセスを許可する）。
2. **Root Directory** を `app` にする。Framework は Next.js（自動）。
3. Environment Variables に入れる：
   - `NEXT_PUBLIC_SUPABASE_URL`：§4-7 の Project URL
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`：§4-7 の publishable キー
   - `NEXT_PUBLIC_ENABLE_SIMULATOR`：`false`（発表のデモでシミュレーターを使うなら `true`）
4. 「Deploy」。できた URL（`https://<名前>.vercel.app`）をメモする。
5. `main` に変更がマージされるたびに、自動で公開し直される。

## 6. 公開したあとの設定

1. **Google**（§3 の画面）：クライアントの「承認済みのリダイレクト URI」に `https://<名前>.vercel.app/settings/calendar/callback` を追加する。
2. **Supabase**：関数に戻り先を教える（ローカル用も残しておく）。
   ```bash
   npx supabase secrets set GOOGLE_REDIRECT_URIS=https://<名前>.vercel.app/settings/calendar/callback,http://localhost:3000/settings/calendar/callback
   ```
3. **Supabase**：§4-6 の Site URL に Vercel の URL を入れる。
4. **鶏**：公開した Webアプリでアカウントを作り、「デバイス」で鶏を登録してトークンを発行し直す。ラズパイの `/etc/nerukokko/chicken.env` の `SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`・`DEVICE_TOKEN` を本番の値にして `sudo systemctl restart nerukokko-chicken`（`firmware/chicken/README.md`）。

## 7. お金がかからないことの確認

| サービス | プラン | 気をつけること |
|---|---|---|
| Gemini API | 無料枠 | 回数の上限を超えると一時的に使えなくなる（そのときは定型文で動く）。送った内容は Google の改善に使われる（予定の名前・メールアドレスは送っていない） |
| Google Cloud（Calendar API） | 無料 | 請求先アカウントを作らない |
| Supabase | Free | 1週間使わないと一時停止。DB 500MB・関数の呼び出し 50万回/月まで |
| Vercel | Hobby | 商用は不可（授業の発表は問題ない） |
