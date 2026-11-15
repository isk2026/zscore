"""② 등급 변화 · ③ 실전 기록 · ① 모델 포트폴리오 — 임시 폴더에서만 쓰기."""

import pytest

from zscore import config as C
from zscore import tracking
from zscore.portfolio import macro_for, model_portfolio


@pytest.fixture(autouse=True)
def tmp_paths(tmp_path, monkeypatch):
    for name in ("TIER_HISTORY_PATH", "TIER_CHANGES_CSV", "LIVE_RECORD_PATH", "LIVE_PUBLIC_PATH", "ALERT_PATH"):
        monkeypatch.setattr(C, name, tmp_path / name.lower())


def stock(t, tier, price=100.0, flags=(), sector="Tech", industry="Software", comp=3.5, mom=3.5):
    return {"ticker": t, "name": t, "tier": tier, "price": price, "sector": sector, "industry": industry,
            "composite_score": comp, "momentum_score": mom,
            "flags": [{"key": f, "title": f, "level": "danger"} for f in flags]}


def test_history_diff_and_rerun_same_day():
    s1 = {"A": stock("A", 2), "B": stock("B", 1), "C": stock("C", 3)}
    first = tracking.update_history("US", "2026-11-13", s1)
    assert first["prev"] is None and first["items"] == []
    s2 = {"A": stock("A", 1), "B": stock("B", 3, flags=["momentum_crash"]), "C": stock("C", 4)}
    ch = tracking.update_history("US", "2026-11-14", s2)
    kinds = {(c["ticker"], c["kind"]) for c in ch["items"]}
    assert kinds == {("A", "enter_t1"), ("B", "exit_t1"), ("B", "flag"), ("C", "down")}
    assert ch["is_new"]
    tracking.mark_notified("US", "2026-11-14")
    again = tracking.update_history("US", "2026-11-14", s2)  # 같은 기준일 재실행
    assert not again["is_new"]
    assert C.TIER_CHANGES_CSV.read_text(encoding="utf-8").count("2026-11-14") == 4  # 중복 기록 없음
    tl = tracking.timelines("US")
    assert tl["tiers"]["A"] == "21"


def _model(holdings, E=0.8):
    return {"equity_weight": E, "regime": 1,
            "holdings": [{"ticker": t, "weight": w, "tier": 1, "price": None} for t, w in holdings]}


def test_live_record_marks_to_market_and_rebalances_monthly():
    s = {"A": stock("A", 1, 100), "B": stock("B", 2, 50)}
    tracking.update_live("US", "2026-11-13", s, _model([("A", 0.5)]), 1000.0)
    s2 = {"A": stock("A", 1, 110), "B": stock("B", 2, 50)}
    m = tracking.update_live("US", "2026-11-20", s2, _model([("A", 0.5)]), 1010.0)
    first_cost = 1 - 0.5 * C.BACKTEST_COST
    assert m["nav"][-1]["model"] == pytest.approx(first_cost * (0.5 + 0.5 * 1.1), rel=1e-6)
    assert m["nav"][-1]["index"] == pytest.approx(1.01)
    assert len(m["rebalances"]) == 1  # 같은 달 → 리밸런싱 없음
    m = tracking.update_live("US", "2026-12-01", s2, _model([("B", 0.5)]), 1010.0)
    assert len(m["rebalances"]) == 2 and m["rebalances"][-1]["holdings"].keys() == {"B"}
    assert m["rebalances"][-1]["turnover"] > 0.4  # A 전량 → B


def test_model_portfolio_budget_caps_and_exclusion():
    stocks = [stock(f"T1_{i}", 1, sector=f"S{i % 4}") for i in range(12)]
    stocks += [stock("BAD", 1, flags=["momentum_crash"], comp=5, mom=5)]
    stocks += [stock(f"T2_{i}", 2, sector=f"S{i}") for i in range(6)]
    macro = macro_for({"markets": {"US": {"next_weight": 0.8, "allocation": {"regime": 3}}},
                       "regimes": {"3": {"name": "하락 방어"}}}, "US", "test")
    mp = model_portfolio(stocks, macro)
    tickers = {h["ticker"] for h in mp["holdings"]}
    assert "BAD" not in tickers and mp["excluded"][0]["ticker"] == "BAD"
    assert sum(h["tier"] == 1 for h in mp["holdings"]) == C.MODEL_TOP_N[1]
    assert all(h["weight"] <= C.TIERS[h["tier"]]["max_weight"] + 1e-9 for h in mp["holdings"])
    assert mp["invested"] <= 0.8 + 1e-9
    assert not any(h["tier"] == 3 for h in mp["holdings"])  # 하락 방어 국면: T3 예산 0


def test_beta_missing_falls_back():
    m = macro_for(None, "KR", "none")
    assert not m["available"] and m["equity_weight"] == C.BETA_FALLBACK_EQUITY


def test_alert_html_escapes_and_groups():
    ch = {"as_of": "2026-11-14", "prev": "2026-11-13",
          "items": [{"ticker": "X", "name": "A&B <Co>", "from": 2, "to": 1, "kind": "enter_t1"}]}
    html = tracking.alert_html("US", ch, {"available": True, "regime": 1, "regime_name": "상승", "equity_weight": 0.8}, None)
    assert "A&amp;B &lt;Co&gt;" in html and "Tier 1 진입" in html and "80%" in html
