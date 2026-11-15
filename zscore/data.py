"""1단계 데이터 수집: yfinance (미국·한국 공통, 한국은 .KS/.KQ).

종목별 원자료(info·연간 재무 3표·EPS 추정치 추이·서프라이즈·2년 일봉)를 받아
`data/cache/<ticker>.pkl` 에 CACHE_HOURS 동안 보관한다. 실패한 항목은 None 으로 두고
지표 계산 단계가 결측을 중립(Z=0)으로 처리한다.
"""

from __future__ import annotations

import logging
import pickle
import time
from dataclasses import dataclass, field
from typing import Any

import pandas as pd
import yfinance as yf

from . import config as C

log = logging.getLogger(__name__)


@dataclass
class RawData:
    ticker: str
    info: dict[str, Any] = field(default_factory=dict)
    income: pd.DataFrame | None = None
    balance: pd.DataFrame | None = None
    cashflow: pd.DataFrame | None = None
    eps_trend: pd.DataFrame | None = None
    earnings_history: pd.DataFrame | None = None
    prices: pd.DataFrame | None = None
    fetched_at: float = 0.0


def market_of(ticker: str) -> str:
    return "KR" if ticker.upper().endswith((".KS", ".KQ")) else "US"


def normalize_ticker(raw: str) -> str:
    """'005930' → '005930.KS', 'brk.b' → 'BRK-B'."""
    t = raw.strip().upper()
    if t.isdigit() and len(t) == 6:
        return f"{t}.KS"
    if not t.endswith((".KS", ".KQ")):
        t = t.replace(".", "-")
    return t


def _safe(fn, name: str, ticker: str):
    try:
        v = fn()
        if isinstance(v, pd.DataFrame) and v.empty:
            return None
        return v
    except Exception as e:  # noqa: BLE001 — yfinance 는 항목별로 다양한 예외를 던진다
        log.debug("%s %s 실패: %s", ticker, name, e)
        return None


def _cache_path(ticker: str):
    return C.CACHE_DIR / f"{ticker.replace('^', '_')}.pkl"


def fetch(ticker: str, refresh: bool = False) -> RawData:
    path = _cache_path(ticker)
    if not refresh and path.exists():
        try:
            raw: RawData = pickle.loads(path.read_bytes())
            if time.time() - raw.fetched_at < C.CACHE_HOURS * 3600:
                return raw
        except Exception as e:  # noqa: BLE001 — 깨진 캐시는 다시 받는다
            log.debug("%s 캐시 무시: %s", ticker, e)

    t = yf.Ticker(ticker)
    raw = RawData(ticker=ticker, fetched_at=time.time())
    raw.info = _safe(lambda: t.info, "info", ticker) or {}
    raw.income = _safe(lambda: t.income_stmt, "income", ticker)
    raw.balance = _safe(lambda: t.balance_sheet, "balance", ticker)
    raw.cashflow = _safe(lambda: t.cashflow, "cashflow", ticker)
    raw.eps_trend = _safe(lambda: t.eps_trend, "eps_trend", ticker)
    raw.earnings_history = _safe(lambda: t.earnings_history, "earnings_history", ticker)
    raw.prices = _safe(
        lambda: t.history(period=C.PRICE_HISTORY_PERIOD, auto_adjust=True)[["Close", "Volume"]],
        "prices", ticker,
    )
    if raw.prices is not None:
        raw.prices.index = pd.DatetimeIndex(raw.prices.index).tz_localize(None).normalize()

    C.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path.write_bytes(pickle.dumps(raw))
    return raw


_BENCH: dict[str, tuple[float, pd.Series]] = {}


def fetch_benchmark(market: str, refresh: bool = False) -> pd.Series:
    """지수는 재무 정보가 없으므로 일봉만 받는다 (프로세스 내 CACHE_HOURS 메모리 캐시)."""
    hit = _BENCH.get(market)
    if hit and not refresh and time.time() - hit[0] < C.CACHE_HOURS * 3600:
        return hit[1]
    sym = C.BENCHMARK[market]
    h = yf.Ticker(sym).history(period=C.PRICE_HISTORY_PERIOD, auto_adjust=True)
    if h.empty:
        raise RuntimeError(f"벤치마크 {sym} 가격을 받지 못했습니다")
    s = h["Close"]
    s.index = pd.DatetimeIndex(s.index).tz_localize(None).normalize()
    _BENCH[market] = (time.time(), s)
    return s
