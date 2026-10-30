# クラウドの準備と公開の手順（田村さん向け）

最終更新：2026-10-30　作成：田村（Claude Code と作成）

アカウントの作成と、秘密の値（キー・シークレット）の入力は**人（田村さん）が行う**手順です。Claude はアカウントを作ったり、キーを入力したりしません。
**どのサービスも無料の範囲で使い、クレジットカードは登録しない**（決定ログ 2026-10-16）。途中で「お支払い情報」「請求先アカウント」を求められたら、そこで止めて相談してください。

| § | やること | いつ | 必要なもの |
|---|---|---|---|
| 1 | Gemini の API キー | 済み（10/16） | Google アカウント |
| 2 | ローカルでカレンダー連携を試す | **いつでも（T-205 の確認）** | Google アカウント |
| 3 | Google Cloud の OAuth クライアント（カレンダー連携） | §2 と同時 | Google アカウント |
| 4 | Supabase のクラウドのプロジェクト | **済み（10/30）** | GitHub アカウント |
| 5 | Vercel（Webアプリの公開） | **済み（10/30）**：https://nerukokko.vercel.app | GitHub アカウント |
| 6 | 公開したあとの設定（Google・鶏） | Supabase の URL 設定は済み（10/30）。Google・鶏はこれから | |
| 9 | main にマージしたら Supabase にも自動で反映する（GitHub Actions） | §4 のあと（1回だけ設定） | GitHub のリポジトリの管理権限 |

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
   - 「Security」の3つのチェックは**既定のまま**：「Enable Data API」✅、「**Automatically expose new tables」✅（外さない）**、「Enable automatic RLS」はオフ。マイグレーションはテーブルの権限を Supabase の既定に任せているので、2つめを外すとログインした人もテーブルを読めずアプリが動かない（全テーブルに RLS があり、トークンの表は権限を取り上げてあるので安全）。
2. プロジェクトの「Project Settings」→「General」の **Reference ID** をメモする（秘密ではない）。
3. 手元で DB と関数をクラウドに入れる（**必ず `server/` フォルダで実行**。別の場所だと `.env` などが見つからない。`link` でデータベースのパスワードを聞かれる）。
   ```bash
   cd server
   npx supabase login
   npx supabase link --project-ref <Reference ID>
   npx supabase db push
   npx supabase functions deploy
   ```
4. 関数の秘密の値を入れる。ローカルの `.env` からそのまま入れると、キーを画面に出さずに済む（`server/` で実行）。
   ```bash
   npx supabase secrets set --env-file supabase/functions/.env
   npx supabase secrets list
   ```
   `secrets list` に `GEMINI_API_KEY` があれば OK（値は表示されない）。Google の値は §3 のあとで `.env` に書いてから、同じコマンドをもう一度実行する。
   `GOOGLE_REDIRECT_URIS` は §5 で Vercel の URL が決まってから入れる（§6）。
5. 定期実行（記録の自動締め・夕方の提案）のために、ダッシュボードの「SQL Editor」で次を実行する。secret キーは「Project Settings」→「API Keys」の **secret** キー（`sb_secret_…`）。**SQL Editor は書いた SQL を自動で保存する**（左の「PRIVATE」に「Untitled query」として残る）ので、実行したら**キーを書いたクエリを削除する**。ジョブがあるかは `select jobname, schedule, active from cron.job;`（2つ出る）、関数を呼べているかは `select status_code, created from net._http_response order by created desc limit 5;`（200 があれば OK。10分ごとに増える）で確かめる。
   ```sql
   select vault.create_secret('https://<Reference ID>.supabase.co', 'project_url');
   select vault.create_secret('<secret キー>', 'secret_key');
   ```
   **`<Reference ID>` と `<secret キー>` は、`< >` ごと本当の値に書き換えてから実行する**（そのまま入れると、ジョブが `invalid URL` で失敗し続ける。10/30 に一度あった）。入れ間違えたときは `vault.update_secret` で直す：
   ```sql
   select vault.update_secret((select id from vault.secrets where name = 'project_url'), 'https://<Reference ID>.supabase.co');
   ```
   値の形は `select name, left(decrypted_secret, 10), length(decrypted_secret) from vault.decrypted_secrets;` で確かめられる（キーは先頭10文字しか出ない）。ジョブの失敗の理由は `select status, return_message from cron.job_run_details order by start_time desc limit 5;`。
6. 「Authentication」→「Sign In / Providers」のページの一番上の「**User Signups**」で、**「Confirm email」をオフ**にして保存する（「Allow new users to sign up」はオンのまま）。標準のメール送信は制限が厳しく、メンバーに確認メールが届かないことがあるため。※「Email」を押して開くパネルの中にはない。
7. Webアプリに入れる値をメモする：
   - Project URL：`https://<Reference ID>.supabase.co`。「Project Settings」→「Data API」に出る URL は `…/rest/v1/` が付いているので、**末尾の `/rest/v1/` を取る**（付けたままだと Webアプリが Supabase につながらない）。
   - **publishable** キー：「Project Settings」→「API Keys」の Publishable key（`sb_publishable_…`。公開してよい値）。下の Secret keys や「Legacy API Keys」（`eyJ…`）は使わない。

## 5. Vercel（Webアプリの公開）

Hobby プラン（無料）で作ります。

1. https://vercel.com に GitHub アカウントでログインし、「Add New…」→「Project」→ `think-of-chicken-team4/nerukokko` を Import する（組織のリポジトリが出ないときは、GitHub 側で Vercel のアクセスを許可する）。
2. **Root Directory** を `app` にする。Framework は Next.js（自動）。
3. Environment Variables に入れる。**種類（Type）は3つとも「Config」**（秘密ではない設定値）にする。`NEXT_PUBLIC_` の付いた値を「Secret」にすると保存できない（「Remove the public framework prefix…」と出る）。**種類は作ったあとで変えられない**ので、間違えたら削除して作り直す。環境は Production（と Preview）。
   - `NEXT_PUBLIC_SUPABASE_URL`：§4-7 の Project URL（末尾に `/rest/v1/` や `/` を付けない）
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`：§4-7 の publishable キー
   - `NEXT_PUBLIC_ENABLE_SIMULATOR`：`true`（実機がなくてもメンバーが試せるように。発表の前に `false` にする）
   - 今の Vercel では、環境変数は「Settings」→「Environments」→「Production」を開いた中にある。
4. 「Deploy」。できた URL（`https://<名前>.vercel.app`）をメモする。
5. `main` に変更がマージされるたびに、自動で公開し直される。**環境変数を変えたときは「Deployments」→「…」→「Redeploy」が必要**（`NEXT_PUBLIC_` の値はビルドのときに埋め込まれる）。

**全ページが「Internal Server Error」になるとき**：Vercel の「Logs」を見る。`Invalid supabaseUrl` なら `NEXT_PUBLIC_SUPABASE_URL` の形が違う（`https://` がない、`/rest/v1/` が付いている、`< >` や空白が残っている）。`URL and Key are required` なら値が入っていない。直して Redeploy する。

## 6. 公開したあとの設定

1. **Google**（§3 の画面）：クライアントの「承認済みのリダイレクト URI」に `https://<名前>.vercel.app/settings/calendar/callback` を追加する。
2. **Supabase**：関数に戻り先を教える（ローカル用も残しておく）。
   ```bash
   npx supabase secrets set GOOGLE_REDIRECT_URIS=https://<名前>.vercel.app/settings/calendar/callback,http://localhost:3000/settings/calendar/callback
   ```
3. **Supabase**：「Authentication」→「URL Configuration」の **Site URL** に `https://<名前>.vercel.app`、**Redirect URLs** に `https://<名前>.vercel.app/**` を入れる（10/30 済み）。
4. **鶏**：公開した Webアプリでアカウントを作り、「デバイス」で鶏を登録してトークンを発行し直す。ラズパイの `/etc/nerukokko/chicken.env` の `SUPABASE_URL`・`SUPABASE_PUBLISHABLE_KEY`・`DEVICE_TOKEN` を本番の値にして `sudo systemctl restart nerukokko-chicken`（`firmware/chicken/README.md`）。

## 7. お金がかからないことの確認

| サービス | プラン | 気をつけること |
|---|---|---|
| Gemini API | 無料枠 | 回数の上限を超えると一時的に使えなくなる（そのときは定型文で動く）。送った内容は Google の改善に使われる（予定の名前・メールアドレスは送っていない） |
| Google Cloud（Calendar API） | 無料 | 請求先アカウントを作らない |
| Supabase | Free | 1週間使わないと一時停止。DB 500MB・関数の呼び出し 50万回/月まで |
| Vercel | Hobby | 商用は不可（授業の発表は問題ない） |

## 8. 公開した後の確認（10/30 に全部できた）

公開した Webアプリで、新しいアカウントを作って順に試す。

1. 新規登録（確認メールなしでホームに入れる）
2. 設定でアラームを追加
3. チャットで一言送る（にわとりから返事が来る＝Gemini が動いている）
4. 設定 →「デバイスシミュレーターを開く」→「▶ デモを始める」（最後に「デモが終わりました」）
5. ホームに睡眠スコアとにわとりのコメント、「記録」にグラフが出る
6. 設定 →「カレンダー連携」は、§3 をするまで「準備中」と出る（正常）

## 9. main にマージしたら Supabase にも自動で反映する（GitHub Actions）

公開したあとの更新は次のとおり。

| 変えたもの | 公開のしかた |
|---|---|
| Webアプリ（`app/`） | main にマージすると **Vercel** が自動で作り直して公開する |
| DB（`server/supabase/migrations/`）・関数（`server/supabase/functions/`）・`config.toml` | main にマージすると **GitHub Actions**（`.github/workflows/deploy-supabase.yml`「Supabase に公開」）が、テストのあとに `db push` と `functions deploy` を自動で行う |
| 関数の秘密の値（`GEMINI_API_KEY` など）・Vault | **手で行う**（§4-4・§4-5）。新しいキーを足したら `npx supabase secrets set` を忘れない |

### 最初に1回だけ行う設定（田村さん）

1. **Supabase のアクセストークンを作る**：https://supabase.com/dashboard/account/tokens →「Generate new token」。名前は `github-actions-nerukokko`。表示されたトークン（`sbp_…`）をコピーする（**一度しか表示されない**。チャットに貼らない）。
2. **GitHub に登録する**：リポジトリ（think-of-chicken-team4/nerukokko）の「Settings」→「Secrets and variables」→「Actions」。
   - 「Secrets」タブ →「New repository secret」で2つ：
     - `SUPABASE_ACCESS_TOKEN`：1 のトークン
     - `SUPABASE_DB_PASSWORD`：§4-1 で作ったデータベースのパスワード
   - 「Variables」タブ →「New repository variable」で1つ：
     - `SUPABASE_PROJECT_ID`：`puvcjmwneebkhtyhwyfn`（Reference ID。秘密ではない）
   - 「Settings」が見えないときは、リポジトリの管理権限（Admin）が必要。組織のオーナーに頼む。
3. **試しに動かす**：リポジトリの「Actions」→ 左の「Supabase に公開」→「Run workflow」→「Run workflow」。緑のチェックになれば OK（新しいマイグレーションがなければ「Remote database is up to date」、関数は全部公開し直される）。

`SUPABASE_PROJECT_ID` を登録するまでは、このワークフローは動かずに飛ばされる（マージが失敗にはならない）。

### 気をつけること

- **マイグレーションは main にマージした時点で本番の DB に入る**。適用済みのマイグレーションは書き換えない（CLAUDE.md §8）。失敗したら Actions の画面が赤くなり、GitHub からメールが来る。ログを Claude に見せる。
- 本番の DB に入ったマイグレーションは元に戻せない。消す・変える変更は、新しいマイグレーションで行う。
- PR では動かない（秘密の値を PR のコードに渡さないため）。PR の CI（`ci.yml`）で、同じテストが通ることを確かめる。
- Vercel（画面）と Supabase（DB・関数）は別々に公開されるので、マージ直後の1〜2分は、片方だけ新しいことがある。
