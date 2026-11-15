"""① 탑다운 × 바텀업: Beta Model 국면·주식 비중 → Tier 예산 → 울타리 적용 모델 포트폴리오.

시장(미국/한국) 계좌 하나를 100% 로 보고
  주식 몫 E = Beta Model 다음 거래일 주식 비중
  Tier t 예산 = E × TIER_BUDGET_BY_REGIME[국면][t]
  Tier 안에서 심각 경고 종목 제외 → (종합+모멘텀) 상위 N → 동일가중
  → 종목 상한(min(8%, Tier 상한)) → 섹터 35% → 클러스터 상한 순으로 깎고, 깎인 몫은 현금.
"""

from __future__ import annotations

import json
import logging
import urllib.request
from typing import Any

from . import config as C

log = logging.getLogger(__name__)


def load_beta_model() -> tuple[dict[str, Any] | None, str]:
    """공개 URL → 로컬 Beta Model 폴더 순서. (데이터, 출처)"""
    try:
        req = urllib.request.Request(C.BETA_MODEL_URL, headers={"User-Agent": "zscore-dashboard"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")), "pages"
    except Exception as e:  # noqa: BLE001 — 연결 실패 시 로컬 → 기본값
        log.warning("Beta Model URL 실패: %s", e)
    if C.BETA_MODEL_LOCAL.exists():
        try:
            return json.loads(C.BETA_MODEL_LOCAL.read_text(encoding="utf-8")), "local"
        except Exception as e:  # noqa: BLE001
            log.warning("Beta Model 로컬 파일 실패: %s", e)
    return None, "none"


def macro_for(beta: dict[str, Any] | None, market: str, source: str) -> dict[str, Any]:
    m = (beta or {}).get("markets", {}).get(market)
    if not m:
        return {"available": False, "source": source, "equity_weight": C.BETA_FALLBACK_EQUITY,
                "regime": None, "regime_name": "Beta Model 미연결 (기본 주식 비중)"}
    a = m.get("allocation", {})
    regime = a.get("regime")
    reg = (beta.get("regimes") or {}).get(str(regime), {})
    return {
        "available": True, "source": source, "as_of": m.get("as_of"),
        "equity_weight": float(m.get("next_weight") or a.get("stock_weight") or C.BETA_FALLBACK_EQUITY),
        "target_weight": a.get("stock_weight"),
        "regime": regime, "regime_name": a.get("regime_name") or reg.get("name"),
        "regime_summary": reg.get("summary"),
        "trend_score": a.get("trend_score"), "risk_score": a.get("risk_score"),
    }


def _excluded(r: dict) -> bool:
    keys = {f["key"] if isinstance(f, dict) else f for f in r.get("flags", [])}
    return bool(keys & C.MODEL_EXCLUDE_FLAGS)


def _clusters_of(industry: str) -> list[str]:
    return [c["name"] for c in C.FENCE["clusters"] if industry in c["industries"]]


def model_portfolio(stocks: list[dict[str, Any]], macro: dict[str, Any]) -> dict[str, Any]:
    E = macro["equity_weight"]
    regime = macro.get("regime") or 1
    budget = C.TIER_BUDGET_BY_REGIME.get(regime, C.TIER_BUDGET_BY_REGIME[1])
    picks, skipped = [], []
    for tier, share in budget.items():
        cands = [r for r in stocks if r.get("tier") == tier]
        clean = [r for r in cands if not _excluded(r)]
        skipped += [{"ticker": r["ticker"], "name": r["name"], "tier": tier,
                     "why": [f["title"] for f in r.get("flags", []) if f["key"] in C.MODEL_EXCLUDE_FLAGS]}
                    for r in cands if _excluded(r)]
        if share <= 0 or not clean:
            continue
        clean.sort(key=lambda r: -((r.get("composite_score") or 0) + (r.get("momentum_score") or 0)))
        top = clean[: C.MODEL_TOP_N[tier]]
        cap = min(C.FENCE["stock_max"], C.TIERS[tier]["max_weight"])
        for r in top:
            picks.append({
                "ticker": r["ticker"], "name": r["name"], "tier": tier, "sector": r.get("sector"),
                "industry": r.get("industry"), "clusters": _clusters_of(r.get("industry") or ""),
                "price": r.get("price"), "composite": r.get("composite_score"), "momentum": r.get("momentum_score"),
                "raw_weight": E * share / len(top), "weight": min(E * share / len(top), cap),
            })

    def shrink(pred, limit):
        g = [p for p in picks if pred(p)]
        tot = sum(p["weight"] for p in g)
        if tot > limit:
            for p in g:
                p["weight"] *= limit / tot

    for _ in range(3):
        for sec in {p["sector"] for p in picks}:
            shrink(lambda p, s=sec: p["sector"] == s, C.FENCE["sector_max"])
        for c in C.FENCE["clusters"]:
            shrink(lambda p, n=c["name"]: n in p["clusters"], c["limit"])

    picks.sort(key=lambda p: (p["tier"], -p["weight"]))
    invested = sum(p["weight"] for p in picks)
    return {
        "equity_weight": E, "regime": regime, "tier_budget": budget,
        "invested": invested, "cash": 1 - invested,
        "fence_cash": E - invested,  # 울타리(상한) 때문에 현금으로 남은 몫
        "holdings": picks, "excluded": skipped,
    }
