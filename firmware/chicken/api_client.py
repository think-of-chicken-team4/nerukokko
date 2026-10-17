"""鶏 → サーバー（Supabase Edge Functions）の通信。docs/api-spec.md §1・§3。

鶏は publishable キー（公開してよい値）とデバイストークン（鶏ごとの秘密の値）で認証する。
secret キー（service_role）は絶対に鶏に置かない（CLAUDE.md §6）。
"""

from __future__ import annotations

import base64
import logging
from dataclasses import dataclass
from enum import Enum
from typing import Any, Optional

import requests

logger = logging.getLogger(__name__)


class Outcome(Enum):
    OK = "ok"
    # 送り直しても直らない（形式の誤りなど）→ データを捨てる
    DROP = "drop"
    # トークンの設定ミス（401・404）→ データは残し、間をあけて試す。ログで知らせる
    AUTH = "auth"
    # 混雑・サーバーの障害・通信できない → データを残して送り直す
    RETRY = "retry"
    # 大きすぎる（413）→ 分けて送る
    TOO_LARGE = "too_large"


def classify(status: Optional[int]) -> Outcome:
    """HTTP の状態から、鶏がどうするかを決める（api-spec §1-4）。status が None は通信できなかったとき"""
    if status is None:
        return Outcome.RETRY
    if 200 <= status < 300:
        return Outcome.OK
    if status in (401, 403, 404):
        return Outcome.AUTH
    if status == 413:
        return Outcome.TOO_LARGE
    if status == 429 or status >= 500:
        return Outcome.RETRY
    return Outcome.DROP


@dataclass
class ApiResult:
    outcome: Outcome
    status: Optional[int]
    body: Any = None


class ApiClient:
    def __init__(self, base_url: str, publishable_key: str, device_token: str, timeout_sec: float = 15.0) -> None:
        self._base = base_url.rstrip("/") + "/functions/v1"
        self._headers = {"apikey": publishable_key, "x-device-token": device_token}
        self._timeout = timeout_sec
        self._session = requests.Session()

    @property
    def configured(self) -> bool:
        return bool(self._base and self._headers["apikey"] and self._headers["x-device-token"])

    def _post(self, name: str, *, json_body: Any = None, data: Optional[bytes] = None, content_type: str = "application/json",
              params: Optional[dict] = None, timeout: Optional[float] = None) -> ApiResult:
        headers = {**self._headers, "Content-Type": content_type}
        try:
            res = self._session.post(
                f"{self._base}/{name}", json=json_body, data=data, headers=headers, params=params,
                timeout=timeout or self._timeout,
            )
        except requests.RequestException as error:
            logger.warning("%s：通信できませんでした（%s）", name, type(error).__name__)
            return ApiResult(Outcome.RETRY, None)
        outcome = classify(res.status_code)
        try:
            body = res.json()
        except ValueError:
            body = None
        if outcome is Outcome.AUTH:
            logger.error("%s：認証に失敗しました（HTTP %s）。.env の DEVICE_TOKEN と SUPABASE_URL を確かめてください", name, res.status_code)
        elif outcome is not Outcome.OK:
            logger.warning("%s：HTTP %s %s", name, res.status_code, body)
        return ApiResult(outcome, res.status_code, body)

    def ingest(self, payload: dict) -> ApiResult:
        """計測データを送る（§3-1）"""
        return self._post("ingest-sensor-data", json_body=payload)

    def device_sync(self, payload: dict) -> ApiResult:
        """状態を報告し、次のアラーム・設定・話す内容を受け取る（§3-2）"""
        return self._post("device-sync", json_body=payload)

    def speak(self, text: str) -> Optional[bytes]:
        """文章をにわとりの声（WAV）にする（§3-4）。できなければ None"""
        result = self._post("speak", json_body={"text": text}, timeout=60)
        return _decode_audio(result)

    def voice_chat(self, wav: bytes, chat_session_id: Optional[str]) -> Optional[dict]:
        """録音を送り、返事を受け取る（§3-3）。{chat_session_id, user_text, reply_text, audio(bytes|None), fallback}"""
        params = {"chat_session_id": chat_session_id} if chat_session_id else None
        result = self._post("voice-chat", data=wav, content_type="audio/wav", params=params, timeout=90)
        if result.outcome is not Outcome.OK or not isinstance(result.body, dict):
            return None
        reply = dict(result.body)
        reply["audio"] = _decode_audio(result)
        return reply


def _decode_audio(result: ApiResult) -> Optional[bytes]:
    if result.outcome is not Outcome.OK or not isinstance(result.body, dict):
        return None
    audio = result.body.get("audio")
    if not isinstance(audio, dict) or not audio.get("base64"):
        return None
    try:
        return base64.b64decode(audio["base64"])
    except (ValueError, TypeError):
        return None
