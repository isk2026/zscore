"""오프라인 단위 테스트 — 합성 데이터만 사용 (네트워크 없음)."""

import numpy as np
import pandas as pd
import pytest

from zscore import config as C
from zscore.data import RawData, normalize_ticker
from zscore.metrics import altman, piotroski, price_metrics
from zscore.scoring import classify_tier, risk_flags, score_basket, to_score


def stmt(rows: dict[str, list[float]]) -> pd.DataFrame:
    cols = pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31"])
    return pd.DataFrame(rows, index=cols).T


def healthy_raw() -> RawData:
    inc = stmt({"Net Income": [120, 100, 90], "Total Revenue": [1000, 900, 850],
                "Gross Profit": [450, 380, 350], "EBIT": [180, 150, 140]})
    bal = stmt({"Total Assets": [1000, 980, 950], "Long Term Debt": [100, 150, 160],
                "Current Assets": [500, 420, 400], "Current Liabilities": [200, 210, 220],
                "Ordinary Shares Number": [100, 100, 101], "Stockholders Equity": [600, 550, 500],
                "Total Liabilities Net Minority Interest": [400, 430, 450],
                "Retained Earnings": [300, 250, 200], "Working Capital": [300, 210, 180]})
    cf = stmt({"Operating Cash Flow": [160, 130, 120], "Free Cash Flow": [110, 90, 80]})
    return RawData("TEST", info={"sector": "Technology"}, income=inc, balance=bal, cashflow=cf)


def test_piotroski_perfect():
    r = piotroski(healthy_raw())
    assert r["fscore"] == 9 and r["fscore_available"] == 9


def test_piotroski_partial_scaled():
    raw = healthy_raw()
    raw.income = raw.income.drop(index="Gross Profit")  # 은행처럼 매출총이익 없음
    r = piotroski(raw)
    assert r["fscore_available"] == 8 and r["fscore"] == 9


def test_altman_formula():
    r = altman(healthy_raw(), market_cap=2000)
    x = [300 / 1000, 300 / 1000, 180 / 1000, 2000 / 400, 1000 / 1000]
    assert r["altman_z"] == pytest.approx(1.2 * x[0] + 1.4 * x[1] + 3.3 * x[2] + 0.6 * x[3] + 0.999 * x[4])


def test_altman_skips_financials():
    raw = healthy_raw()
    raw.info["sector"] = "Financial Services"
    assert altman(raw, 2000)["altman_z"] is None


def test_momentum_12_1_excludes_last_month():
    idx = pd.bdate_range("2024-01-01", periods=300)
    close = np.linspace(100, 200, 300)
    close[-21:] = 50  # 최근 1개월 폭락은 12-1M 수익률에 반영되지 않아야 함
    raw = RawData("X", prices=pd.DataFrame({"Close": close, "Volume": 1e6}, index=idx))
    pm = price_metrics(raw, None)
    assert pm["ret_12_1"] == pytest.approx(close[-22] / close[-253] - 1)
    assert pm["high52_ratio"] == pytest.approx(50 / close[-252:].max())


def test_tier_matrix():
    assert classify_tier(3.2, 3.1) == 1
    assert classify_tier(3.2, 2.0) == 2
    assert classify_tier(2.5, 3.6) == 3
    assert classify_tier(2.5, 3.4) == 4
    assert classify_tier(None, None) == 4


def test_score_scale_clipped():
    assert to_score(0) == 3.0 and to_score(9) == 5.0 and to_score(-9) == 1.0


def _basket(n=30, seed=0):
    rng = np.random.default_rng(seed)
    recs = []
    for i in range(n):
        q = rng.normal()
        recs.append({
            "ticker": f"T{i}", "market": "US",
            "fcf_to_assets": 0.05 + 0.03 * q, "ocf_to_assets": 0.08 + 0.03 * q, "accruals": -0.02 * q,
            "revenue_growth": 0.1 + 0.05 * q, "earnings_growth": 0.1 + 0.1 * q,
            "roe": 0.15 + 0.05 * q, "roa": 0.07 + 0.02 * q, "gross_margin": 0.4 + 0.1 * q,
            "fscore": int(np.clip(5 + 2 * q, 0, 9)), "altman_z_capped": 3 + q, "debt_to_equity": 0.5 - 0.2 * q,
            "earnings_yield": 0.05, "fcf_yield": 0.04, "book_to_price": 0.3,
            "ret_12_1": rng.normal(0.1, 0.3), "high52_ratio": rng.uniform(0.6, 1),
            "rel_strength": rng.normal(0, 0.2), "eps_revision": rng.normal(0, 0.05),
            "avg_traded_value": 1e9,
        })
    return recs


def test_basket_scores_centered():
    scored, stats = score_basket(_basket())
    comp = [r["composite_score"] for r in scored]
    assert np.mean(comp) == pytest.approx(3.0, abs=0.05)
    best = max(scored, key=lambda r: r["fcf_to_assets"])
    assert best["composite_score"] > 3.5  # 펀더멘털이 가장 좋은 종목은 상위
    assert set(stats) >= {"metrics", "factors", "composite", "momentum"}


def test_theme_hype_and_bankruptcy_flags():
    rec = {"momentum_score": 4.0, "fscore": 2, "altman_z": 1.2, "market": "US",
           "avg_traded_value": 1e5, "factor_z": {}}
    keys = {f["key"] for f in risk_flags(rec)}
    assert {"theme_hype", "bankruptcy", "low_liquidity"} <= keys


def test_value_trap_flag():
    rec = {"momentum_score": 2.0, "factor_z": {"valuation": 1.2}, "ret_12_1": -0.2,
           "eps_revision": -0.05, "market": "US"}
    assert "value_trap" in {f["key"] for f in risk_flags(rec)}


def test_normalize_ticker():
    assert normalize_ticker("005930") == "005930.KS"
    assert normalize_ticker("brk.b") == "BRK-B"
    assert normalize_ticker("247540.kq") == "247540.KQ"
    assert C.UNIVERSE["KR"]["005930.KS"] == "삼성전자"


# ── 백테스트 ────────────────────────────────────────────────────────────────
def test_slice_raw_respects_report_lag():
    from zscore.backtest import slice_raw
    raw = healthy_raw()
    idx = pd.bdate_range("2023-01-02", "2026-06-30")
    raw.prices = pd.DataFrame({"Close": np.linspace(10, 20, len(idx)), "Volume": 1e6}, index=idx)
    raw.info["marketCap"] = 999  # 현재 시총은 과거 시점에 쓰면 안 됨
    s = slice_raw(raw, pd.Timestamp("2026-03-15"))  # FY2025(12/31) + 90일 = 2026-03-31 이전
    assert list(s.income.columns) == list(pd.to_datetime(["2024-12-31", "2023-12-31"]))
    assert s.prices.index[-1] <= pd.Timestamp("2026-03-15")
    assert "marketCap" not in s.info
    s2 = slice_raw(raw, pd.Timestamp("2026-04-30"))
    assert s2.income.columns[0] == pd.Timestamp("2025-12-31")


def test_perf_stats():
    from zscore.backtest import perf
    st = perf([0.1, -0.5, 0.2])
    assert st["total"] == pytest.approx(1.1 * 0.5 * 1.2 - 1)
    assert st["mdd"] == pytest.approx(-0.5)
