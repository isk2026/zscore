"""울타리 탭 위험 분석용 데이터 → dashboard/public/data/risk.json.

보유 비중은 브라우저에만 있으므로 계산(공분산·베타·상관 묶음·스트레스 합산)은 프론트에서 하고,
여기서는 재료만 만든다: 종목·지수·환율의 주간 수익률(2년)과 과거 하락 구간별 종목 수익률.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import pandas as pd
import yfinance as yf

from . import config as C
from .data import fetch, fetch_benchmark

log = logging.getLogger(__name__)


def _norm(s: pd.Series) -> pd.Series:
    s = s.dropna()
    idx = pd.DatetimeIndex(s.index)
    s.index = (idx.tz_localize(None) if idx.tz is not None else idx).normalize()
    return s[~s.index.duplicated(keep="last")]


def _closes(tickers: list[str]) -> dict[str, pd.Series]:
    out = {}
    for t in tickers:
        try:
            p = fetch(t).prices
            if p is not None and not p.empty:
                out[t] = _norm(p["Close"])
        except Exception as e:  # noqa: BLE001
            log.warning("%s 가격 없음: %s", t, e)
    return out


def fx_close() -> pd.Series | None:
    try:
        h = yf.Ticker(C.FX_SYMBOL).history(period=C.PRICE_HISTORY_PERIOD, auto_adjust=True)
        return _norm(h["Close"]) if not h.empty else None
    except Exception as e:  # noqa: BLE001 — 환율 없이도 나머지는 계산
        log.warning("환율 실패: %s", e)
        return None


def window_return(s: pd.Series, start: str, end: str) -> float | None:
    before = s[s.index < pd.Timestamp(start)]
    upto = s[s.index <= pd.Timestamp(end)]
    if before.empty or upto.empty or upto.index[-1] < pd.Timestamp(start):
        return None
    return float(upto.iloc[-1] / before.iloc[-1] - 1)


def max_drawdown_window(s: pd.Series, days: int = 252) -> tuple[str, str, float]:
    w = s.iloc[-days:]
    dd = w / w.cummax() - 1
    trough = dd.idxmin()
    peak = w.loc[:trough].idxmax()
    # 시작 '전날' 종가 기준이 되도록 고점 다음 날을 시작일로
    nxt = w.index[w.index.get_loc(peak) + 1] if peak != w.index[-1] else peak
    return nxt.strftime("%Y-%m-%d"), trough.strftime("%Y-%m-%d"), float(dd.min())


def weekly(s: pd.Series) -> pd.Series:
    return s.resample("W-FRI").last().pct_change(fill_method=None)


def build(tickers_by_market: dict[str, list[str]]) -> dict[str, Any]:
    closes: dict[str, pd.Series] = {}
    for ts in tickers_by_market.values():
        closes.update(_closes(ts))
    bench = {m: _norm(fetch_benchmark(m)) for m in tickers_by_market}
    fx = fx_close()

    rets = pd.DataFrame({t: weekly(s) for t, s in closes.items()})
    idx_rets = pd.DataFrame({m: weekly(s) for m, s in bench.items()})
    weeks = idx_rets.dropna(how="all").index[-C.RISK_WEEKS:]
    r = lambda x: None if pd.isna(x) else round(float(x), 5)

    windows = [dict(w, kind="event") for w in C.STRESS_WINDOWS]
    for m, s in bench.items():
        start, end, dd = max_drawdown_window(s)
        if dd < -0.05:
            label = {"US": "S&P500", "KR": "KOSPI"}.get(m, m)
            windows.append({"name": f"최근 1년 {label} 최대 낙폭", "start": start, "end": end, "kind": "recent"})
    stress = []
    for w in windows:
        stress.append({
            **w,
            "index": {m: r(window_return(s, w["start"], w["end"])) for m, s in bench.items()},
            "fx": r(window_return(fx, w["start"], w["end"])) if fx is not None else None,
            "ret": {t: v for t, s in closes.items() if (v := r(window_return(s, w["start"], w["end"]))) is not None},
        })

    fx_w = weekly(fx).reindex(weeks) if fx is not None else None
    return {
        "as_of": max(s.index[-1] for s in bench.values()).strftime("%Y-%m-%d"),
        "weeks": [d.strftime("%Y-%m-%d") for d in weeks],
        "ret": {t: [r(x) for x in rets[t].reindex(weeks)] for t in rets},
        "index": {m: [r(x) for x in idx_rets[m].reindex(weeks)] for m in idx_rets},
        "fx": [r(x) for x in fx_w] if fx_w is not None else None,
        "stress": stress,
        "config": {"corr_cluster": C.CORR_CLUSTER, "weeks": C.RISK_WEEKS, "fx_symbol": C.FX_SYMBOL},
    }


def write(tickers_by_market: dict[str, list[str]]) -> None:
    out = build(tickers_by_market)
    C.RISK_PATH.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log.info("위험 데이터: %s (%d종목 · %d주 · 스트레스 %d개, %.0f KB)", C.RISK_PATH.name, len(out["ret"]),
             len(out["weeks"]), len(out["stress"]), C.RISK_PATH.stat().st_size / 1024)
