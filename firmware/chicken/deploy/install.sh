#!/usr/bin/env bash
# 鶏（ラズパイ）に、自動で起動する設定を入れる（F-06）。README.md の手順の中で、1回だけ実行する。
#   sudo ./deploy/install.sh [Acconeer の exploration server の場所]
#   例：sudo ./deploy/install.sh /home/pi/acconeer/out/acc_exploration_server_a111
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "sudo を付けて実行してください" >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$HERE" != "/opt/nerukokko/firmware/chicken" ]]; then
  echo "リポジトリを /opt/nerukokko に置いてから実行してください（いま：$HERE）" >&2
  exit 1
fi

# 設定ファイル（なければ見本から作る。秘密の値が入るので root だけが読めるようにする）
mkdir -p /etc/nerukokko /var/lib/nerukokko
if [[ ! -f /etc/nerukokko/chicken.env ]]; then
  cp "$HERE/.env.example" /etc/nerukokko/chicken.env
  echo "→ /etc/nerukokko/chicken.env を作りました。SUPABASE_URL・SUPABASE_PUBLISHABLE_KEY・DEVICE_TOKEN を入れてください"
fi
chmod 600 /etc/nerukokko/chicken.env

install -m 644 "$HERE/deploy/nerukokko-chicken.service" /etc/systemd/system/
install -m 644 "$HERE/deploy/nerukokko.tmpfiles.conf" /etc/tmpfiles.d/nerukokko.conf
systemd-tmpfiles --create /etc/tmpfiles.d/nerukokko.conf

# 画面（目・タッチ）：デスクトップにログインしているユーザーで動かす。sudo を実行したユーザーを使う
EYES_USER="${SUDO_USER:-}"
if [[ -n "$EYES_USER" && "$EYES_USER" != "root" ]]; then
  sed "s#EYES_USER#$EYES_USER#g" "$HERE/deploy/nerukokko-eyes.service" > /etc/systemd/system/nerukokko-eyes.service
  EYES_ENABLED=1
else
  echo "（sudo を実行したユーザーが分からないので、画面の自動起動は設定していません。普通のユーザーで sudo を付けて実行してください）"
  EYES_ENABLED=0
fi
if [[ $# -ge 1 ]]; then
  sed "s#ACCONEER_SERVER#$1#" "$HERE/deploy/acconeer-server.service" > /etc/systemd/system/acconeer-server.service
  systemctl enable acconeer-server.service
  echo "→ レーダーの exploration server を自動で起動するようにしました：$1"
else
  echo "（レーダーの exploration server の場所を指定しなかったので、自動起動は設定していません）"
fi

systemctl daemon-reload
systemctl enable nerukokko-chicken.service
if [[ "$EYES_ENABLED" == "1" ]]; then
  systemctl enable nerukokko-eyes.service
  echo "→ 画面（目・タッチ）を、$EYES_USER で自動起動するようにしました"
fi
echo "→ 完了。設定ファイルを書いたら：sudo systemctl restart nerukokko-chicken nerukokko-eyes"
echo "   ログ：journalctl -u nerukokko-chicken -f ／ journalctl -u nerukokko-eyes -f"
