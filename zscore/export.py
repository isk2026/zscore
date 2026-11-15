"""유니버스 전체를 채점해 dashboard/public/data/screener.json 으로 내보낸다.

    uv run python -m zscore.export            # 캐시(12시간) 사용
    uv run python -m zscore.export --refresh  # 전부 새로 받기
    uv run python -m zscore.export --market KR
    uv run python -m zscore.export --add ASML,TSM,005490   # 추가 종목 등록(data/extra_tickers.txt) 후 채점
    uv run python -m zscore.export --remove ASML
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from . import config as C
from .data import fetch, fetch_benchmark, market_of, normalize_ticker
from .metrics import compute_raw
from .scoring import score_basket, score_external

log = logging.getLogger("zscore")


def clean(o: Any) -> Any:
    """JSON 직렬화: NaN/inf → None, numpy 스칼라 → 파이썬, 소수 6자리."""
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if hasattr(o, "item") and not isinstance(o, (str, bytes)):
        o = o.item()
    if isinstance(o, float):
        if not math.isfinite(o):
            return None
        return round(o, 6)
    return o


def read_extra() -> list[str]:
    p = C.EXTRA_TICKERS_PATH
    if not p.exists():
        return []
    out = []
    for line in p.read_text(encoding="utf-8").splitlines():
        t = line.split("#")[0].strip()
        if t:
            out.append(normalize_ticker(t))
    return list(dict.fromkeys(out))


def write_extra(tickers: list[str]) -> None:
    C.EXTRA_TICKERS_PATH.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# 유니버스 밖 추가 채점 종목 (한 줄에 하나). Run workflow 의 tickers 입력으로도 추가된다",
             *sorted(set(tickers))]
    C.EXTRA_TICKERS_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _collect(tickers: list[str], bench, names: dict, refresh: bool) -> list[dict]:
    def one(t: str):
        try:
            return compute_raw(fetch(t, refresh=refresh), bench, names.get(t))
        except Exception as e:  # noqa: BLE001 — 한 종목 실패가 전체를 멈추지 않게
            log.warning("%s 실패: %s", t, e)
            return None

    with ThreadPoolExecutor(C.FETCH_WORKERS) as ex:
        return [r for r in ex.map(one, tickers) if r and r.get("price") is not None]


def build_market(market: str, refresh: bool = False, extra: list[str] | None = None):
    bench = fetch_benchmark(market, refresh=refresh)
    names = C.UNIVERSE[market]
    t0 = time.time()
    recs = _collect(list(names), bench, names, refresh)
    log.info("%s: %d/%d 종목 수집 (%.0fs)", market, len(recs), len(names), time.time() - t0)
    scored, stats = score_basket(recs)
    rows = [summary(r) for r in scored]
    ext = [t for t in (extra or []) if market_of(t) == market and t not in names]
    extra_scored = {}
    for r in _collect(ext, bench, {}, refresh):
        r = score_external(r, stats, rows)
        r["_extra"] = True
        extra_scored[r["ticker"]] = r
    if ext:
        log.info("%s 추가 종목: %d/%d 채점", market, len(extra_scored), len(ext))
    return scored, stats, rows, extra_scored


def summary(rec: dict) -> dict:
    """스크리너 표·매트릭스용 경량 레코드 (상세는 stocks 에)."""
    keys = ["ticker", "market", "name", "sector", "industry", "price", "change_pct", "market_cap",
            "composite_score", "momentum_score", "tier", "fscore", "altman_z", "ret_12_1",
            "high52_ratio", "eps_revision", "pe", "factor_scores", "single_condition"]
    out = {k: rec.get(k) for k in keys}
    out["flags"] = [f["key"] for f in rec.get("flags", [])]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--market", choices=list(C.UNIVERSE), action="append")
    ap.add_argument("--add", default="", help="추가 종목 (쉼표/공백 구분)")
    ap.add_argument("--remove", default="", help="추가 종목에서 제거")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    split = lambda s: [normalize_ticker(x) for x in s.replace(",", " ").split() if x.strip()]
    extra = read_extra()
    if args.add or args.remove:
        rm = set(split(args.remove))
        extra = [t for t in dict.fromkeys(extra + split(args.add)) if t not in rm]
        write_extra(extra)
        log.info("추가 종목 목록: %s", ", ".join(extra) or "(없음)")

    markets = args.market or list(C.UNIVERSE)
    prev = {}
    if C.EXPORT_PATH.exists() and args.market:  # 일부 시장만 갱신 시 나머지 유지
        prev = json.loads(C.EXPORT_PATH.read_text(encoding="utf-8"))

    payload: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "markets": prev.get("markets", {}),
        "config": {
            "tiers": C.TIERS,
            "factor_labels": C.FACTOR_LABELS,
            "composite_weights": C.COMPOSITE_WEIGHTS,
            "momentum_weights": C.MOMENTUM_WEIGHTS,
            "thresholds": {
                "tier_composite": C.TIER_COMPOSITE, "tier_momentum": C.TIER_MOMENTUM,
                "tier3_momentum": C.TIER3_MOMENTUM, "altman_distress": C.ALTMAN_DISTRESS,
                "altman_safe": C.ALTMAN_SAFE, "fscore_strong": C.FSCORE_STRONG,
            },
            "fence": C.FENCE,
            "min_traded_value": C.MIN_TRADED_VALUE,
            "benchmark": C.BENCHMARK,
        },
    }
    for m in markets:
        scored, stats, rows, extra_scored = build_market(m, refresh=args.refresh, extra=extra)
        payload["markets"][m] = {
            "as_of": max((r.get("as_of") or "") for r in scored) if scored else None,
            "stats": stats,
            "rows": rows,
            "stocks": {r["ticker"]: r for r in scored},
            "extra": extra_scored,
        }
    C.EXPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    C.EXPORT_PATH.write_text(json.dumps(clean(payload), ensure_ascii=False, separators=(",", ":")),
                             encoding="utf-8")
    kb = C.EXPORT_PATH.stat().st_size / 1024
    log.info("저장: %s (%.0f KB)", C.EXPORT_PATH, kb)
    for m in markets:
        rows = payload["markets"][m]["rows"]
        dist = {t: sum(1 for r in rows if r["tier"] == t) for t in (1, 2, 3, 4)}
        log.info("%s Tier 분포: %s", m, dist)


if __name__ == "__main__":
    main()
