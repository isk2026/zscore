"""수급 계산 · '왜 이 등급인가' · 데이터 신뢰도."""

import pytest

from zscore import config as C
from zscore.explain import quality, top_share, why
from zscore.flows import kr_flows, us_flows


def _row(d, f, o, i=0, close=1000, hold="50.00%"):
    return {"bizdate": d, "foreignerPureBuyQuant": f"{f:+,}", "organPureBuyQuant": f"{o:+,}",
            "individualPureBuyQuant": f"{i:+,}", "closePrice": f"{close:,}", "foreignerHoldRatio": hold}


def test_kr_flows_sums_value_and_streak():
    rows = [_row(f"202611{d:02d}", 100, 50, hold="51.00%" if d == 25 else "50.00%") for d in range(1, 26)]
    fl = kr_flows(rows, market_cap=1e9)
    assert fl["days"] == C.FLOWS_DAYS
    assert fl["foreign"] == pytest.approx(100 * 1000 * C.FLOWS_DAYS)
    assert fl["foreign_pct"] == pytest.approx(fl["foreign"] / 1e9)
    assert fl["foreign_streak"] == C.FLOWS_DAYS and fl["tone"] == "good"
    assert fl["hold_chg"] == pytest.approx(0.01) and fl["as_of"] == "2026-11-25"
    bad = kr_flows([_row(f"202611{d:02d}", -1, -1) for d in range(1, 10)], 1e9)
    assert bad["signal"] == "외국인·기관 동반 순매도" and bad["foreign_streak"] == -9


def test_us_flows_signals():
    assert us_flows({"shortPercentOfFloat": 0.15})["tone"] == "bad"
    assert us_flows({"shortPercentOfFloat": 0.02, "sharesShort": 130, "sharesShortPriorMonth": 100})["signal"] == "공매도 잔고 급증"
    assert us_flows({"shortPercentOfFloat": 0.02, "sharesShort": 70, "sharesShortPriorMonth": 100})["tone"] == "good"
    assert us_flows({}) is None


def _rec(tier, c, m, **kw):
    return {"tier": tier, "composite_score": c, "momentum_score": m, "sector": "Technology",
            "factor_z": {"cashflow": 1.6, "growth": 0.1, "profitability": 0.8, "stability": -0.7, "valuation": 0, "momentum": -1},
            "metric_z": {"ret_12_1": -0.2, "high52_ratio": 0.3, "rel_strength": -1.6, "eps_revision": 0.1},
            "rel_strength": -0.29, "flags": [], **kw}


def test_why_names_strengths_and_failing_axis():
    w = why(_rec(2, 3.6, 2.2))
    assert w["line"].startswith("현금흐름 상위 5%·수익성 상위 21%")
    assert "6M 상대강도 -29%(하위 5%)" in w["line"] and w["line"].endswith("Tier 2")
    assert "모멘텀 2.20 < 3.0" in w["rule"]
    w3 = why(_rec(3, 2.5, 3.8, flows={"tone": "bad", "signal": "외국인·기관 동반 순매도"}))
    assert "재무안정 하위" in w3["line"] and "추세의 질" in w3["notes"][0]


def test_quality_flags_stale_and_missing():
    rec = {"sector": "Technology", "as_of": "2026-11-01", "fy_end": "2025-03-31", "fscore": 7}
    q = quality(rec, "2026-11-13")
    assert q["available"] == 1 and q["total"] == 18
    assert any("12일 오래됨" in w for w in q["warn"]) and any("2025-03-31" in w for w in q["warn"])
    assert top_share(0) == pytest.approx(0.5)
