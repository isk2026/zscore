"""시점 재현(point-in-time) 월간 백테스트 — "성과는 규칙으로 검증한다".

매 월말 d 에
  · 가격 지표: d 까지의 종가만 사용 (12-1M, 52주 고점비, 6M 상대강도, 3M 낙폭, 200일선)
  · 재무 지표: 회계연도 종료 + REPORT_LAG_DAYS ≤ d 인 연간 재무만 사용, 시가총액 = d 종가 × 당시 주식수
  · EPS 추정치 수정: 과거 이력이 없어 제외 (모멘텀 가중을 나머지 지표로 재정규화)
로 바스켓을 다시 채점 → Tier 별 동일가중 포트폴리오를 다음 월말까지 보유.

    uv run python -m zscore.backtest            # 캐시 사용 (export 직후면 즉시)
    uv run python -m zscore.backtest --refresh

한계: 유니버스가 '오늘' 기준이라 생존 편향이 있고, 무료 재무가 4년치뿐이라 기간이 짧다.
"""

from __future__ import annotations

import argparse
import copy
import itertools
import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

import numpy as np
import pandas as pd

from . import config as C
from .data import RawData, fetch, fetch_benchmark
from .export import clean
from .metrics import compute_raw
from .scoring import score_basket

log = logging.getLogger("zscore.backtest")


def slice_raw(raw: RawData, d: pd.Timestamp) -> RawData | None:
    """d 시점에 알 수 있었던 정보만 남긴 RawData."""
    if raw.prices is None:
        return None
    prices = raw.prices.loc[:d]
    if len(prices) < 130:
        return None

    def cut(df: pd.DataFrame | None) -> pd.DataFrame | None:
        if df is None:
            return None
        cols = [c for c in df.columns if pd.Timestamp(c) + pd.Timedelta(days=C.REPORT_LAG_DAYS) <= d]
        cols = sorted(cols, reverse=True)
        return df[cols] if cols else None

    info = {k: v for k, v in raw.info.items() if k not in ("marketCap", "sharesOutstanding")}
    return RawData(ticker=raw.ticker, info=info, income=cut(raw.income), balance=cut(raw.balance),
                   cashflow=cut(raw.cashflow), prices=prices)


def month_ends(index: pd.DatetimeIndex) -> list[pd.Timestamp]:
    s = pd.Series(index, index=index)
    return list(s.groupby([index.year, index.month]).max())


def _price_at(raw: RawData, d: pd.Timestamp) -> float | None:
    c = raw.prices["Close"].loc[:d].dropna()
    return float(c.iloc[-1]) if len(c) else None


def perf(rets: list[float]) -> dict[str, float | None]:
    r = np.asarray(rets, dtype=float)
    if len(r) == 0:
        return {}
    eq = np.cumprod(1 + r)
    peak = np.maximum.accumulate(np.concatenate([[1.0], eq]))[1:]
    sd = r.std(ddof=1) if len(r) > 1 else 0.0
    return {
        "total": float(eq[-1] - 1),
        "cagr": float(eq[-1] ** (12 / len(r)) - 1),
        "vol": float(sd * np.sqrt(12)),
        "sharpe": float(r.mean() / sd * np.sqrt(12)) if sd > 0 else None,
        "mdd": float((eq / peak - 1).min()),
        "best": float(r.max()), "worst": float(r.min()),
    }


def _spearman(a: list[float], b: list[float]) -> float | None:
    if len(a) < 8:
        return None
    ra, rb = pd.Series(a).rank(), pd.Series(b).rank()
    v = ra.corr(rb)
    return None if pd.isna(v) else float(v)


PORTS = {
    "T1": {"label": "Tier 1 핵심 주도주", "pick": lambda r: r["tier"] == 1},
    "T1_clean": {"label": "Tier 1 · 심각 경고 제외", "pick": lambda r: r["tier"] == 1 and not _danger(r)},
    "T2": {"label": "Tier 2 펀더멘털", "pick": lambda r: r["tier"] == 2},
    "T3": {"label": "Tier 3 모멘텀", "pick": lambda r: r["tier"] == 3},
    "T4": {"label": "Tier 4 관찰 대상", "pick": lambda r: r["tier"] == 4},
    "EW": {"label": "유니버스 동일가중", "pick": lambda r: True},
}


def _danger(r: dict) -> bool:
    return any(f["level"] == "danger" for f in r.get("flags", []))


def run_market(market: str, refresh: bool = False) -> dict[str, Any]:
    bench = fetch_benchmark(market, refresh=refresh)
    names = C.UNIVERSE[market]
    with ThreadPoolExecutor(C.FETCH_WORKERS) as ex:
        raws = {r.ticker: r for r in ex.map(lambda t: fetch(t, refresh=refresh), names) if r.prices is not None}

    dates = month_ends(bench.index)
    if dates and dates[-1] == bench.index[-1] and bench.index[-1].day < 25:
        dates = dates[:-1]  # 진행 중인 달 제외

    snaps: list[tuple[pd.Timestamp, list[dict]]] = []
    for d in dates:
        recs = []
        for t, raw in raws.items():
            s = slice_raw(raw, d)
            if s is None:
                continue
            rec = compute_raw(s, bench.loc[:d], names.get(t), chart=False)
            rec["eps_revision"] = None
            recs.append(rec)
        # 2개 회계연도 이상(성장률·F-Score 계산 가능)을 가진 종목 비율
        have_fin = sum(1 for r in recs if r.get("revenue_growth") is not None and r.get("fscore") is not None)
        if have_fin < C.BACKTEST_MIN_COVERAGE * len(names):
            continue
        scored, _ = score_basket(copy.deepcopy(recs))
        snaps.append((d, scored))
    if len(snaps) < 3:
        raise RuntimeError(f"{market}: 백테스트 가능한 월이 부족합니다 ({len(snaps)})")
    log.info("%s: %s ~ %s, %d개월", market, snaps[0][0].date(), snaps[-1][0].date(), len(snaps) - 1)

    rets: dict[str, list[float]] = {k: [] for k in PORTS}
    rets["INDEX"] = []
    holdings: dict[str, list[int]] = {k: [] for k in PORTS}
    turnover: dict[str, list[float]] = {k: [] for k in PORTS}
    prev_w: dict[str, dict[str, float]] = {k: {} for k in PORTS}
    ic_comp, ic_mom, tier_log = [], [], []
    period_dates = []

    for (d0, scored), (d1, _) in itertools.pairwise(snaps):
        fwd = {}
        for r in scored:
            raw = raws[r["ticker"]]
            p0, p1 = _price_at(raw, d0), _price_at(raw, d1)
            if p0 and p1:
                fwd[r["ticker"]] = p1 / p0 - 1
        b0, b1 = bench.loc[:d0].iloc[-1], bench.loc[:d1].iloc[-1]
        rets["INDEX"].append(float(b1 / b0 - 1))
        period_dates.append(d1.strftime("%Y-%m-%d"))

        for k, spec in PORTS.items():
            picks = [r["ticker"] for r in scored if spec["pick"](r) and r["ticker"] in fwd]
            w = {t: 1 / len(picks) for t in picks} if picks else {}
            to = 0.5 * sum(abs(w.get(t, 0) - prev_w[k].get(t, 0)) for t in set(w) | set(prev_w[k]))
            gross = float(np.mean([fwd[t] for t in picks])) if picks else 0.0  # 비면 현금
            rets[k].append(gross - 2 * to * C.BACKTEST_COST)
            holdings[k].append(len(picks))
            turnover[k].append(to)
            prev_w[k] = w

        pairs = [(r["composite_score"], r["momentum_score"], fwd[r["ticker"]]) for r in scored
                 if r["ticker"] in fwd and r["composite_score"] is not None and r["momentum_score"] is not None]
        ic_comp.append(_spearman([p[0] for p in pairs], [p[2] for p in pairs]))
        ic_mom.append(_spearman([p[1] for p in pairs], [p[2] for p in pairs]))
        tier_log.append({
            "date": d0.strftime("%Y-%m-%d"),
            "T1": sorted((r["ticker"] for r in scored if r["tier"] == 1),
                         key=lambda t: names.get(t) or t),
        })

    def ic_stats(xs):
        v = [x for x in xs if x is not None]
        if len(v) < 3:
            return {"mean": None, "t": None, "hit": None}
        a = np.asarray(v)
        return {"mean": float(a.mean()), "t": float(a.mean() / a.std(ddof=1) * np.sqrt(len(a))),
                "hit": float((a > 0).mean())}

    ew = rets["EW"]
    series = {}
    for k in [*PORTS, "INDEX"]:
        r = rets[k]
        st = perf(r)
        if k in PORTS:
            st["avg_holdings"] = float(np.mean(holdings[k]))
            st["turnover"] = float(np.mean(turnover[k][1:])) if len(turnover[k]) > 1 else None
            st["beat_ew"] = float(np.mean([a > b for a, b in zip(r, ew, strict=False)])) if k != "EW" else None
        series[k] = {
            "label": PORTS[k]["label"] if k in PORTS else f"지수 {C.BENCHMARK[market]}",
            "returns": r,
            "equity": list(np.cumprod(1 + np.asarray(r))),
            "stats": st,
        }
    names_map = {t: (names.get(t) or raws[t].info.get("shortName") or t) for t in raws}
    return {
        "start": snaps[0][0].strftime("%Y-%m-%d"),
        "end": snaps[-1][0].strftime("%Y-%m-%d"),
        "months": len(period_dates),
        "dates": [snaps[0][0].strftime("%Y-%m-%d"), *period_dates],
        "series": series,
        "ic": {"composite": ic_stats(ic_comp), "momentum": ic_stats(ic_mom),
               "composite_series": ic_comp, "momentum_series": ic_mom},
        "tier1_history": tier_log[-6:],
        "names": names_map,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    out: dict[str, Any] = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "assumptions": {
            "rebalance": "월말 종가 신호 → 같은 종가로 편입, 다음 월말까지 동일가중 보유",
            "report_lag_days": C.REPORT_LAG_DAYS,
            "cost_one_way": C.BACKTEST_COST,
            "excluded": ["EPS 추정치 30일 수정 (과거 이력 없음)"],
            "caveats": [
                "생존 편향: 유니버스를 오늘 기준으로 골랐다 (이후 크게 오른 종목이 포함되어 있음)",
                "기간이 짧다: 무료 연간 재무가 4년치뿐이라 약 2~3년, 표본 수가 적어 통계적 유의성이 낮다",
                "종가 기준 즉시 체결 가정 (Beta Model 처럼 익일 집행 지연 없음)",
                "같은 데이터로 규칙을 만든 뒤 검증한 것이 아니라 영상의 규칙을 그대로 적용 (파라미터 최적화 없음)",
            ],
        },
        "markets": {},
    }
    for m in C.UNIVERSE:
        out["markets"][m] = run_market(m, refresh=args.refresh)
        s = out["markets"][m]["series"]
        log.info("%s 누적: %s", m, {k: f"{v['stats']['total']:+.1%}" for k, v in s.items()})
        ic = out["markets"][m]["ic"]
        log.info("%s IC 종합 %.3f (t %.1f) · 모멘텀 %.3f (t %.1f)", m,
                 ic["composite"]["mean"] or 0, ic["composite"]["t"] or 0,
                 ic["momentum"]["mean"] or 0, ic["momentum"]["t"] or 0)
    C.BACKTEST_PATH.write_text(json.dumps(clean(out), ensure_ascii=False, separators=(",", ":")),
                               encoding="utf-8")
    log.info("저장: %s (%.0f KB)", C.BACKTEST_PATH, C.BACKTEST_PATH.stat().st_size / 1024)


if __name__ == "__main__":
    main()
