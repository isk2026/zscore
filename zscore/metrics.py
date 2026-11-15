"""2단계 원지표 계산: Piotroski F-Score, Altman Z-Score, 가격·이익 모멘텀, 밸류에이션, 유동성.

모든 함수는 결측에 관대하다 — 계산 불가 항목은 None.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

from . import config as C
from .data import RawData, market_of


def _num(x) -> float | None:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def _row(df: pd.DataFrame | None, names: list[str], col: int = 0) -> float | None:
    """재무제표에서 첫 번째로 존재하는 항목의 col 번째(0=최근) 연도 값."""
    if df is None or df.shape[1] <= col:
        return None
    for n in names:
        if n in df.index:
            v = _num(df.loc[n].iloc[col])
            if v is not None:
                return v
    return None


def _div(a, b) -> float | None:
    if a is None or b is None or b == 0:
        return None
    return a / b


def _growth(cur, prev) -> float | None:
    if cur is None or prev is None or prev == 0:
        return None
    return (cur - prev) / abs(prev)


# ── 재무 ────────────────────────────────────────────────────────────────────
NI = ["Net Income Common Stockholders", "Net Income"]
TA = ["Total Assets"]
OCF = ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"]
FCF = ["Free Cash Flow"]
REV = ["Total Revenue", "Operating Revenue"]
GP = ["Gross Profit"]
LTD = ["Long Term Debt", "Long Term Debt And Capital Lease Obligation"]
CA = ["Current Assets"]
CL = ["Current Liabilities"]
SHARES = ["Ordinary Shares Number", "Share Issued"]
EQ = ["Stockholders Equity", "Common Stock Equity"]
TL = ["Total Liabilities Net Minority Interest"]
RE = ["Retained Earnings"]
EBIT = ["EBIT", "Operating Income"]
WC = ["Working Capital"]
DEBT = ["Total Debt"]


def piotroski(raw: RawData) -> dict[str, Any]:
    """9개 이진 기준. 계산 가능한 기준만 채점하고 9점 만점으로 환산(score)."""
    inc, bal, cf = raw.income, raw.balance, raw.cashflow

    def v(df, names, col=0):
        return _row(df, names, col)

    ta0, ta1, ta2 = v(bal, TA, 0), v(bal, TA, 1), v(bal, TA, 2)
    ni0, ni1 = v(inc, NI, 0), v(inc, NI, 1)
    ocf0 = v(cf, OCF, 0)
    roa0 = _div(ni0, ta1 or ta0)
    roa1 = _div(ni1, ta2 or ta1)
    lev0, lev1 = _div(v(bal, LTD, 0) or 0.0, ta0), _div(v(bal, LTD, 1) or 0.0, ta1)
    cr0, cr1 = _div(v(bal, CA, 0), v(bal, CL, 0)), _div(v(bal, CA, 1), v(bal, CL, 1))
    sh0, sh1 = v(bal, SHARES, 0), v(bal, SHARES, 1)
    gm0, gm1 = _div(v(inc, GP, 0), v(inc, REV, 0)), _div(v(inc, GP, 1), v(inc, REV, 1))
    at0, at1 = _div(v(inc, REV, 0), ta1 or ta0), _div(v(inc, REV, 1), ta2 or ta1)

    def cmp(a, b, op):
        if a is None or b is None:
            return None
        return bool(op(a, b))

    checks = {
        "ROA > 0": None if roa0 is None else roa0 > 0,
        "영업현금흐름 > 0": None if ocf0 is None else ocf0 > 0,
        "ROA 개선": cmp(roa0, roa1, lambda a, b: a > b),
        "현금흐름 > 순이익 (발생액 품질)": cmp(ocf0, ni0, lambda a, b: a > b),
        "장기부채비율 감소": cmp(lev0, lev1, lambda a, b: a <= b),
        "유동비율 개선": cmp(cr0, cr1, lambda a, b: a > b),
        "신주 발행 없음": cmp(sh0, sh1, lambda a, b: a <= b * 1.005),
        "매출총이익률 개선": cmp(gm0, gm1, lambda a, b: a > b),
        "자산회전율 개선": cmp(at0, at1, lambda a, b: a > b),
    }
    avail = [c for c in checks.values() if c is not None]
    passed = sum(avail)
    score = round(passed * 9 / len(avail)) if len(avail) >= 6 else None
    return {"fscore": score, "fscore_raw": passed, "fscore_available": len(avail), "fscore_checks": checks}


def altman(raw: RawData, market_cap: float | None) -> dict[str, Any]:
    sector = raw.info.get("sector")
    if sector in C.FINANCIAL_SECTORS:
        return {"altman_z": None, "altman_note": "금융업 — 모형 비적용"}
    bal, inc = raw.balance, raw.income
    ta = _row(bal, TA)
    wc = _row(bal, WC)
    if wc is None:
        ca, cl = _row(bal, CA), _row(bal, CL)
        wc = None if ca is None or cl is None else ca - cl
    parts = {
        "X1 운전자본/총자산": _div(wc, ta),
        "X2 이익잉여금/총자산": _div(_row(bal, RE), ta),
        "X3 EBIT/총자산": _div(_row(inc, EBIT), ta),
        "X4 시가총액/총부채": _div(market_cap, _row(bal, TL)),
        "X5 매출/총자산": _div(_row(inc, REV), ta),
    }
    if any(p is None for p in parts.values()):
        return {"altman_z": None, "altman_note": "재무 항목 부족", "altman_parts": parts}
    w = [1.2, 1.4, 3.3, 0.6, 0.999]
    z = sum(wi * p for wi, p in zip(w, parts.values()))
    return {"altman_z": z, "altman_parts": parts}


# ── 가격 ────────────────────────────────────────────────────────────────────
def price_metrics(raw: RawData, bench: pd.Series | None) -> dict[str, Any]:
    p = raw.prices
    if p is None or len(p) < 30:
        return {}
    close = p["Close"].dropna()
    last = float(close.iloc[-1])
    out: dict[str, Any] = {
        "price": last,
        "change_pct": float(close.iloc[-1] / close.iloc[-2] - 1) if len(close) > 1 else None,
        "as_of": close.index[-1].strftime("%Y-%m-%d"),
    }
    n = len(close)
    if n >= 253:
        out["ret_12_1"] = float(close.iloc[-22] / close.iloc[-253] - 1)
    elif n >= 130:  # 상장 1년 미만: 가용 구간으로 대체
        out["ret_12_1"] = float(close.iloc[-22] / close.iloc[0] - 1)
    win52 = close.iloc[-252:]
    out["high52"] = float(win52.max())
    out["low52"] = float(win52.min())
    out["high52_ratio"] = last / out["high52"]
    if n >= 200:
        out["ma200"] = float(close.iloc[-200:].mean())
        out["above_ma200"] = last > out["ma200"]
    w63 = close.iloc[-63:]
    out["drawdown_3m"] = float((w63 / w63.cummax() - 1).min())
    out["ret_3m"] = float(close.iloc[-1] / close.iloc[-64] - 1) if n >= 64 else None

    if bench is not None and n >= 127:
        b = bench.reindex(close.index).ffill()
        if b.iloc[-127:].notna().all():
            rs = (close.iloc[-1] / close.iloc[-127]) / (b.iloc[-1] / b.iloc[-127]) - 1
            out["rel_strength"] = float(rs)

    vol = p["Volume"].reindex(close.index).fillna(0)
    out["avg_traded_value"] = float((close * vol).iloc[-20:].mean())

    # 차트용 시계열 (최근 CHART_DAYS 거래일)
    ma = close.rolling(200).mean()
    tail = close.iloc[-C.CHART_DAYS:]
    out["chart"] = {
        "d": [d.strftime("%Y-%m-%d") for d in tail.index],
        "c": [round(float(x), 4) for x in tail],
        "ma200": [None if pd.isna(x) else round(float(x), 4) for x in ma.iloc[-C.CHART_DAYS:]],
        "m_start": close.index[-253].strftime("%Y-%m-%d") if n >= 253 else None,
        "m_end": close.index[-22].strftime("%Y-%m-%d") if n >= 22 else None,
    }
    return out


# ── 이익 모멘텀 ─────────────────────────────────────────────────────────────
def earnings_metrics(raw: RawData) -> dict[str, Any]:
    out: dict[str, Any] = {}
    et = raw.eps_trend
    if et is not None and {"current", "30daysAgo"} <= set(et.columns):
        revs = []
        for period in ("0y", "+1y"):
            if period in et.index:
                cur, old = _num(et.loc[period, "current"]), _num(et.loc[period, "30daysAgo"])
                g = _growth(cur, old)
                if g is not None:
                    revs.append(g)
        if revs:
            out["eps_revision"] = float(np.mean(revs))
        if "0y" in et.index and "+1y" in et.index:
            out["fwd_eps_growth"] = _growth(_num(et.loc["+1y", "current"]), _num(et.loc["0y", "current"]))
    eh = raw.earnings_history
    if eh is not None and "surprisePercent" in eh.columns:
        s = pd.to_numeric(eh["surprisePercent"], errors="coerce").dropna()
        if len(s):
            out["eps_surprise"] = float(s.iloc[-4:].mean())
            out["eps_surprise_last"] = float(s.iloc[-1])
    return out


# ── 종합 ────────────────────────────────────────────────────────────────────
def compute_raw(raw: RawData, bench: pd.Series | None, name: str | None = None) -> dict[str, Any]:
    info = raw.info
    inc, bal, cf = raw.income, raw.balance, raw.cashflow
    pm = price_metrics(raw, bench)
    price = pm.get("price")

    shares = _row(bal, SHARES) or _num(info.get("sharesOutstanding"))
    mcap = _num(info.get("marketCap")) or (price * shares if price and shares else None)

    ta0, ta1 = _row(bal, TA, 0), _row(bal, TA, 1)
    ni0, ni1 = _row(inc, NI, 0), _row(inc, NI, 1)
    ocf0, fcf0 = _row(cf, OCF), _row(cf, FCF)
    eq0 = _row(bal, EQ)
    rev0, rev1 = _row(inc, REV, 0), _row(inc, REV, 1)

    rec: dict[str, Any] = {
        "ticker": raw.ticker,
        "market": market_of(raw.ticker),
        "name": name or info.get("shortName") or info.get("longName") or raw.ticker,
        "sector": info.get("sector") or "기타",
        "industry": info.get("industry") or "기타",
        "currency": info.get("currency") or C.CURRENCY[market_of(raw.ticker)],
        "market_cap": mcap,
        # 현금흐름
        "fcf": fcf0,
        "fcf_to_assets": _div(fcf0, ta0),
        "ocf_to_assets": _div(ocf0, ta0),
        "accruals": _div(None if ni0 is None or ocf0 is None else ni0 - ocf0, ta0),
        # 성장
        "revenue_growth": _growth(rev0, rev1),
        "earnings_growth": _growth(ni0, ni1),
        # 수익성
        "roe": _div(ni0, eq0) if eq0 and eq0 > 0 else None,
        "roa": _div(ni0, ta1 or ta0),
        "gross_margin": _div(_row(inc, GP), rev0),
        # 안정성
        "debt_to_equity": _div(_row(bal, DEBT) or 0.0, eq0) if eq0 and eq0 > 0 else None,
        # 밸류에이션
        "pe": _div(mcap, ni0) if ni0 and ni0 > 0 else None,
        "pb": _div(mcap, eq0) if eq0 and eq0 > 0 else None,
        "earnings_yield": _div(ni0, mcap),
        "fcf_yield": _div(fcf0, mcap),
        "book_to_price": _div(eq0, mcap),
    }
    rec.update(piotroski(raw))
    rec.update(altman(raw, mcap))
    az = rec.get("altman_z")
    rec["altman_z_capped"] = None if az is None else float(np.clip(az, -2, 10))
    rec.update(earnings_metrics(raw))
    rec.update(pm)
    return rec
