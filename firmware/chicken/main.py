"""鶏（Raspberry Pi）のプログラムの入口。

    python3 main.py          # ふつうに起動（ラズパイでは systemd が起動する。deploy/ と README.md）
    LOG_LEVEL=DEBUG python3 main.py

設定は環境変数（ラズパイでは /etc/nerukokko/chicken.env。見本は .env.example）。
"""

from __future__ import annotations

import asyncio
import logging
import os

from app import ChickenApp


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    # bleak の細かいログは、ふだんは出さない
    logging.getLogger("bleak").setLevel(logging.WARNING)
    asyncio.run(ChickenApp().run())


if __name__ == "__main__":
    main()
