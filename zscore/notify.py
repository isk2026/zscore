"""텔레그램 알림 — Beta Model 과 같은 봇(TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID)을 쓴다.

    uv run python -m zscore.notify            # data/alert_pending.html 이 있으면 보내고 지운다
    uv run python -m zscore.notify --dry-run  # 보낼 내용만 출력
    uv run python -m zscore.notify --test     # 연결 확인용 짧은 메시지

설정이 없거나 전송이 실패해도 예외를 밖으로 내지 않는다 (워크플로가 깨지면 안 됨). 토큰은 로그에서 가린다.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

from . import config as C

LIMIT = 3900  # 텔레그램 4096자 제한 여유


def redact(text: str, token: str | None) -> str:
    return text.replace(token, "***") if token else text


def split_message(text: str) -> list[str]:
    parts, cur = [], ""
    for line in text.split("\n"):
        if len(cur) + len(line) + 1 > LIMIT and cur:
            parts.append(cur)
            cur = ""
        cur += line + "\n"
    if cur.strip():
        parts.append(cur)
    return parts


def send_telegram(text: str, opener=None) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        print("텔레그램 설정 없음 — 전송 건너뜀")
        return False
    opener = opener or urllib.request.urlopen
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    ok = True
    for part in split_message(text):
        data = urllib.parse.urlencode({"chat_id": chat_id, "text": part, "parse_mode": "HTML",
                                       "disable_web_page_preview": "true"}).encode()
        try:
            with opener(urllib.request.Request(url, data=data, method="POST"), timeout=20) as resp:
                body = json.loads(resp.read().decode("utf-8") or "{}")
            if not body.get("ok"):
                ok = False
                print("텔레그램 전송 실패: " + redact(str(body.get("description")), token), file=sys.stderr)
        except Exception as e:  # noqa: BLE001 — 알림 실패가 워크플로를 깨면 안 된다
            ok = False
            print("텔레그램 전송 오류: " + redact(f"{type(e).__name__}: {e}", token), file=sys.stderr)
    return ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--test", action="store_true")
    args = ap.parse_args()
    if args.test:
        text = f'<b>주도주 스코어</b> 알림 연결 확인 ✅\n<a href="{C.DASHBOARD_URL}">대시보드</a>'
    elif C.ALERT_PATH.exists():
        text = C.ALERT_PATH.read_text(encoding="utf-8")
    else:
        print("보낼 알림 없음 (등급 변화·리밸런싱 없음)")
        return
    if args.dry_run:
        print(text)
        return
    sent = send_telegram(text)
    if sent and not args.test:
        C.ALERT_PATH.unlink(missing_ok=True)
    print("전송 완료" if sent else "전송 안 함")


if __name__ == "__main__":
    main()
