"""수급 — 한국: 외국인·기관 순매수(네이버 증권 모바일 API), 미국: 공매도(yfinance info).

모멘텀 점수의 '질'을 확인하는 보조 정보다. 점수·등급에는 넣지 않는다.
"""

from __future__ import annotations

import json
import logging
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from . import config as C
from .data import fetch

log = logging.getLogger(__name__)


def _n(s: Any) -> float | None:
    if s is None:
        return None
    try:
        return float(str(s).replace(",", "").replace("%", "").replace("+", ""))
    except ValueError:
        return None


def _kr_rows(code: str, refresh: bool) -> list[dict]:
    path = C.CACHE_DIR / f"flows_{code}.json"
    if path.exists() and not refresh and time.time() - path.stat().st_mtime < C.CACHE_HOURS * 3600:
        return json.loads(path.read_text(encoding="utf-8"))
    req = urllib.request.Request(C.FLOWS_URL.format(code=code), headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        rows = json.loads(r.read().decode("utf-8"))
    C.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    return rows


def kr_flows(rows: list[dict], market_cap: float | None) -> dict[str, Any] | None:
    rows = sorted(rows, key=lambda r: r["bizdate"], reverse=True)[: C.FLOWS_DAYS]
    if len(rows) < 5:
        return None

    def val(key, k=None):
        return sum((_n(r[key]) or 0) * (_n(r["closePrice"]) or 0) for r in rows[:k])

    f, o, i = val("foreignerPureBuyQuant"), val("organPureBuyQuant"), val("individualPureBuyQuant")
    sign = lambda x: (x > 0) - (x < 0)
    first = sign(_n(rows[0]["foreignerPureBuyQuant"]) or 0)
    streak = 0
    for r in rows:
        if first and sign(_n(r["foreignerPureBuyQuant"]) or 0) == first:
            streak += 1
        else:
            break
    hold, hold_then = _n(rows[0].get("foreignerHoldRatio")), _n(rows[-1].get("foreignerHoldRatio"))
    if f > 0 and o > 0:
        signal, tone = "외국인·기관 동반 순매수", "good"
    elif f < 0 and o < 0:
        signal, tone = "외국인·기관 동반 순매도", "bad"
    else:
        signal = f"외국인 순{'매수' if f > 0 else '매도'} · 기관 순{'매수' if o > 0 else '매도'}"
        tone = "neutral"
    d = rows[0]["bizdate"]
    return {
        "kind": "KR", "days": len(rows), "as_of": f"{d[:4]}-{d[4:6]}-{d[6:]}",
        "foreign": f, "organ": o, "individual": i,
        "foreign_pct": f / market_cap if market_cap else None,
        "organ_pct": o / market_cap if market_cap else None,
        "foreign_5d": val("foreignerPureBuyQuant", 5), "organ_5d": val("organPureBuyQuant", 5),
        "foreign_streak": streak * first,
        "hold": hold / 100 if hold is not None else None,
        "hold_chg": (hold - hold_then) / 100 if hold is not None and hold_then is not None else None,
        "signal": signal, "tone": tone,
    }


def us_flows(info: dict[str, Any]) -> dict[str, Any] | None:
    sf, dtc = _n(info.get("shortPercentOfFloat")), _n(info.get("shortRatio"))
    cur, prev = _n(info.get("sharesShort")), _n(info.get("sharesShortPriorMonth"))
    if sf is None and cur is None:
        return None
    chg = cur / prev - 1 if cur and prev else None
    if sf is not None and sf >= C.SHORT_HIGH:
        signal, tone = "공매도 비중 높음", "bad"
    elif chg is not None and chg >= C.SHORT_CHANGE:
        signal, tone = "공매도 잔고 급증", "bad"
    elif chg is not None and chg <= -C.SHORT_CHANGE:
        signal, tone = "공매도 잔고 감소", "good"
    else:
        signal, tone = "공매도 부담 낮음", "neutral"
    ts = info.get("dateShortInterest")
    return {
        "kind": "US", "short_float": sf, "days_to_cover": dtc, "short_chg": chg,
        "inst": _n(info.get("heldPercentInstitutions")),
        "as_of": datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d") if isinstance(ts, (int, float)) else None,
        "signal": signal, "tone": tone,
    }


def attach(records: list[dict[str, Any]], refresh: bool = False) -> None:
    def one(rec):
        t = rec["ticker"]
        try:
            if rec["market"] == "KR":
                return kr_flows(_kr_rows(t.split(".")[0], refresh), rec.get("market_cap"))
            return us_flows(fetch(t).info)
        except Exception as e:  # noqa: BLE001 — 수급은 보조 정보, 실패해도 진행
            log.debug("%s 수급 실패: %s", t, e)
            return None

    with ThreadPoolExecutor(4) as ex:
        for rec, fl in zip(records, ex.map(one, records), strict=True):
            rec["flows"] = fl
    ok = sum(1 for r in records if r.get("flows"))
    log.info("수급: %d/%d 종목", ok, len(records))
