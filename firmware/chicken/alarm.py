"""アラームの時刻と鳴らす／止める判断（F-01・F-02、docs/api-spec.md §3-2「鶏の動作」）。

- device-sync で受け取った alarm.ring_at をファイルに保存する（Wi-Fi が切れても、再起動しても鳴らせるように）
- ring_at になったら鳴らし始め、たまごが巣に戻ったら（Dock Event の docked = 1）すぐ止める。在床の確認はしない
- 最大 max_ring_sec（既定30分）鳴ったら止める。電源が切れていて ring_at を max_ring_sec 以上過ぎていたら鳴らさない
ハードウェアに依存しない。tests/test_alarm.py でテストしている。
"""

from __future__ import annotations

import json
import logging
import os
from enum import Enum
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


class AlarmAction(Enum):
    NONE = "none"
    START = "start"  # 鳴らし始める（LED＋コケコッコー）
    STOP = "stop"  # 止める（最大時間を過ぎた）


class AlarmClock:
    def __init__(self, path: Optional[Path] = None, max_ring_sec: float = 30 * 60) -> None:
        self._path = path
        self._max_ring_sec = max_ring_sec
        self.ring_at: Optional[float] = None
        # 最後に鳴らした ring_at（同じ時刻で二度鳴らさないため）
        self._done_ring_at: Optional[float] = None
        self.ringing_since: Optional[float] = None
        self._load()

    @property
    def ringing(self) -> bool:
        return self.ringing_since is not None

    def set_target(self, ring_at: Optional[float]) -> None:
        """device-sync の alarm.ring_at（なければ None）。鳴っているあいだは今の鳴動を続ける"""
        if ring_at == self.ring_at:
            return
        self.ring_at = ring_at
        self._save()
        logger.info("次のアラーム：%s", "なし" if ring_at is None else ring_at)

    def tick(self, now: float) -> AlarmAction:
        """1秒ごとくらいに呼ぶ"""
        if self.ringing_since is not None:
            if now - self.ringing_since >= self._max_ring_sec:
                logger.info("アラームを最大時間鳴らしたので止めます")
                self.ringing_since = None
                return AlarmAction.STOP
            return AlarmAction.NONE
        target = self.ring_at
        if target is None or target == self._done_ring_at or now < target:
            return AlarmAction.NONE
        self._done_ring_at = target
        self._save()
        if now - target >= self._max_ring_sec:
            logger.warning("アラームの時刻を大きく過ぎていたので鳴らしません（電源が切れていた？）")
            return AlarmAction.NONE
        self.ringing_since = now
        return AlarmAction.START

    def dock(self) -> bool:
        """たまごが巣に戻った。鳴っていたら止めて True"""
        if self.ringing_since is None:
            return False
        self.ringing_since = None
        return True

    def _load(self) -> None:
        if not self._path or not self._path.exists():
            return
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            self.ring_at = data.get("ring_at")
            self._done_ring_at = data.get("done_ring_at")
        except (ValueError, OSError):
            logger.exception("アラームの保存ファイルを読めませんでした")

    def _save(self) -> None:
        if not self._path:
            return
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"ring_at": self.ring_at, "done_ring_at": self._done_ring_at}), encoding="utf-8")
            os.replace(tmp, self._path)
        except OSError:
            logger.exception("アラームを保存できませんでした")
