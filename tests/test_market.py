"""시장폭 · 섹터 주도력 · 시장 알림 — 합성 가격으로 검증."""

import numpy as np
import pandas as pd
import pytest

from zscore import config as C
from zscore import market as M


@pytest.fixture(autouse=True)
def tmp_state(tmp_path, monkeypatch):
    monkeypatch.setattr(C, "MARKET_STATE_PATH", tmp_path / "market_state.json")


def _days(n=520):
    return pd.bdate_range("2025-01-03", periods=n)


def test_zone_hysteresis():
    assert M.zone_of(0.65) == "강함" and M.zone_of(0.5) == "중립" and M.zone_of(0.3) == "약함"
    assert M.zone_of(0.59, prev="강함") == "강함"      # 경계 3%p 안 → 유지
    assert M.zone_of(0.55, prev="강함") == "중립"
    assert M.zone_of(0.41, prev="약함") == "약함"


def test_quadrant():
    assert M.quadrant(102, 101) == "주도" and M.quadrant(102, 99) == "약화"
    assert M.quadrant(98, 99) == "소외" and M.quadrant(98, 101) == "개선"


def test_breadth_divergence_when_index_at_high_but_few_stocks_rise():
    d = _days()
    n = len(d)
    up = np.linspace(100, 200, n)
    # 처음엔 모두 상승, 마지막 40일은 9종목 하락 · 1종목만 상승 (지수는 그 1종목)
    cols = {}
    for i in range(10):
        s = up.copy()
        if i:
            s[-40:] = np.linspace(s[-41], s[-41] * 0.8, 40)
        cols[f"S{i}"] = s
    px = pd.DataFrame(cols, index=d)
    bench = pd.Series(up, index=d)
    b = M.breadth(px, bench)
    assert b["index_near_high"] and b["divergence"]
    assert b["a50"] == pytest.approx(0.1)
    assert len(b["series"]["d"]) == C.BREADTH_DAYS


def test_rrg_leader_vs_laggard():
    d = _days()
    n = len(d)
    bench = pd.Series(np.linspace(100, 120, n), index=d)
    t = np.arange(n)
    lead = 100 * np.exp(0.0006 * t + 0.00002 * np.maximum(0, t - 300) ** 2)  # 최근 가속
    lag = 100 * np.exp(0.0006 * t - 0.00002 * np.maximum(0, t - 300) ** 2)   # 최근 감속
    px = pd.DataFrame({"A": lead, "B": lag}, index=d)
    a, b = M.rrg(px, bench, ["A"]), M.rrg(px, bench, ["B"])
    assert a["quadrant"] == "주도" and b["quadrant"] == "소외"
    assert len(a["tail"]) == C.RRG["tail"]


def _view(zone="강함", div=False, q="주도", week="2026-11-06", a200=0.65):
    return {"breadth": {"as_of": week, "zone": zone, "divergence": div, "a200": a200, "a50": 0.4,
                        "a50_peak": 0.7, "index_vs_high": 0.99},
            "sectors": [{"name": "기술", "quadrant": q, "week": week}]}


def test_update_state_baseline_then_changes_once():
    assert M.update_state("US", _view()) == []                      # 첫 실행 = 기준선
    assert M.update_state("US", _view()) == []                      # 변화 없음
    same_week = M.update_state("US", _view(q="약화"))               # 같은 주 → 섹터 비교 안 함
    assert same_week == []
    lines = M.update_state("US", _view(zone="중립", div=True, q="약화", week="2026-11-13", a200=0.5))
    text = "\n".join(lines)
    assert "시장폭 괴리" in text and "강함 → 중립" in text and "기술: 주도 → <b>약화</b>" in text
    assert M.update_state("US", _view(zone="중립", div=True, q="약화", week="2026-11-13", a200=0.5)) == []


def test_risk_window_return_and_drawdown():
    from zscore import risk as R

    d = pd.bdate_range("2024-01-01", periods=300)
    s = pd.Series(np.r_[np.linspace(100, 150, 150), np.linspace(150, 90, 100), np.linspace(90, 110, 50)], index=d)
    # 시작 전날 종가 → 종료일 종가
    assert R.window_return(s, d[150].strftime("%F"), d[249].strftime("%F")) == pytest.approx(90 / s.iloc[149] - 1)
    assert R.window_return(s, "2020-01-01", "2020-02-01") is None   # 자료 이전 구간
    start, end, dd = R.max_drawdown_window(s, 300)
    assert end == d[249].strftime("%F") and dd == pytest.approx(90 / 150 - 1)
    assert R.window_return(s, start, end) == pytest.approx(dd)       # 같은 규칙으로 재현됨
