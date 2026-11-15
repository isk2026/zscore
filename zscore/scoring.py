"""3~4단계: Z-Score 표준화 → 종합/모멘텀 점수 → 4-Tier → 위험 필터(함정 경고).

바스켓 통계(stats)를 따로 저장해 두면 유니버스 밖 종목도 같은 기준으로 채점할 수 있다(score_one).
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

from . import config as C


def _valid(x) -> bool:
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


def to_score(z: float | None) -> float | None:
    if z is None:
        return None
    return float(np.clip(C.SCORE_CENTER + z, C.SCORE_MIN, C.SCORE_MAX))


def _mu_sd(values: list[float]) -> dict[str, float]:
    a = np.asarray(values, dtype=float)
    sd = float(a.std(ddof=0)) if len(a) > 1 else 0.0
    return {"mu": float(a.mean()) if len(a) else 0.0, "sd": sd if sd > 1e-12 else 1.0}


# ── 바스켓 통계 ─────────────────────────────────────────────────────────────
def fit_stats(records: list[dict[str, Any]]) -> dict[str, Any]:
    metrics: dict[str, dict[str, float]] = {}
    for factor in C.FACTORS.values():
        for m, _ in factor:
            vals = [r[m] for r in records if _valid(r.get(m))]
            if len(vals) < 3:
                metrics[m] = {"lo": -math.inf, "hi": math.inf, "mu": 0.0, "sd": 1.0, "n": len(vals)}
                continue
            lo, hi = np.quantile(vals, C.WINSOR)
            clipped = np.clip(vals, lo, hi)
            metrics[m] = {"lo": float(lo), "hi": float(hi), **_mu_sd(list(clipped)), "n": len(vals)}
    stats: dict[str, Any] = {"metrics": metrics, "factors": {}}

    # 1차: 팩터 원점수 → 팩터 표준화 통계
    raw_f = [_factor_raw(r, stats) for r in records]
    for f in C.FACTORS:
        stats["factors"][f] = _mu_sd([x[f] for x in raw_f if x[f] is not None] or [0.0])

    comp, mom = [], []
    for r in records:
        fz = _factor_z(r, stats)
        c = _composite_raw(fz)
        mo = _momentum_raw(r, stats)
        if c is not None:
            comp.append(c)
        if mo is not None:
            mom.append(mo)
    stats["composite"] = _mu_sd(comp or [0.0])
    stats["momentum"] = _mu_sd(mom or [0.0])
    return stats


def metric_z(rec: dict[str, Any], m: str, stats: dict[str, Any]) -> float | None:
    x = rec.get(m)
    s = stats["metrics"].get(m)
    if not _valid(x) or s is None or s.get("n", 0) < 3:
        return None
    x = min(max(x, s["lo"]), s["hi"])
    return (x - s["mu"]) / s["sd"]


def _factor_raw(rec, stats) -> dict[str, float | None]:
    out = {}
    fin = rec.get("sector") in C.FINANCIAL_SECTORS
    for f, items in C.FACTORS.items():
        zs = [d * z for m, d in items
              if not (fin and m in C.FINANCIAL_SKIP) and (z := metric_z(rec, m, stats)) is not None]
        out[f] = float(np.mean(zs)) if zs else None
    return out


def _factor_z(rec, stats) -> dict[str, float | None]:
    raw = _factor_raw(rec, stats)
    out = {}
    for f, v in raw.items():
        s = stats["factors"].get(f)
        out[f] = None if v is None or s is None else (v - s["mu"]) / s["sd"]
    return out


def _composite_raw(fz: dict[str, float | None]) -> float | None:
    pairs = [(w, fz[f]) for f, w in C.COMPOSITE_WEIGHTS.items() if fz.get(f) is not None]
    wsum = sum(w for w, _ in pairs)
    if wsum < 0.5:  # 펀더멘털 절반 이상 결측 → 채점 불가
        return None
    return sum(w * z for w, z in pairs) / wsum


def _momentum_raw(rec, stats) -> float | None:
    pairs = [(w, z) for m, w in C.MOMENTUM_WEIGHTS.items() if (z := metric_z(rec, m, stats)) is not None]
    wsum = sum(w for w, _ in pairs)
    if wsum < 0.5:
        return None
    return sum(w * z for w, z in pairs) / wsum


# ── 등급 · 함정 ─────────────────────────────────────────────────────────────
def classify_tier(composite: float | None, momentum: float | None) -> int:
    c = composite if composite is not None else 0.0
    m = momentum if momentum is not None else 0.0
    if c >= C.TIER_COMPOSITE and m >= C.TIER_MOMENTUM:
        return 1
    if c >= C.TIER_COMPOSITE:
        return 2
    if m >= C.TIER3_MOMENTUM:
        return 3
    return 4


def risk_flags(rec: dict[str, Any]) -> list[dict[str, str]]:
    flags: list[dict[str, str]] = []
    mom = rec.get("momentum_score")
    val_z = (rec.get("factor_z") or {}).get("valuation")
    r121, rev = rec.get("ret_12_1"), rec.get("eps_revision")
    fs, az = rec.get("fscore"), rec.get("altman_z")

    def add(key, title, level, detail):
        flags.append({"key": key, "title": title, "level": level, "detail": detail})

    # 가치 함정: 싸 보이지만 가격·이익 추세가 모두 하락
    if val_z is not None and val_z >= C.VALUE_TRAP_VAL_Z and _valid(r121) and r121 < 0:
        down_rev = _valid(rev) and rev < 0
        down_growth = rev is None and _valid(rec.get("earnings_growth")) and rec["earnings_growth"] < 0
        if down_rev or down_growth:
            add("value_trap", "가치 함정 (Value Trap)", "warn",
                f"밸류에이션 상위(z {val_z:+.1f})지만 12-1M 수익률 {r121:+.0%}, "
                + (f"EPS 추정치 {rev:+.1%} 하향" if down_rev else "순이익 감소"))

    if mom is not None and mom >= C.HYPE_MOMENTUM:
        dd, fcf = rec.get("drawdown_3m"), rec.get("fcf")
        reasons = []
        if _valid(dd) and dd <= C.CRASH_DRAWDOWN_3M:
            reasons.append(f"3개월 낙폭 {dd:.0%}")
        if _valid(fcf) and fcf < 0:
            reasons.append("잉여현금흐름 적자")
        if reasons:
            add("momentum_crash", "모멘텀 크러시 위험", "danger",
                f"모멘텀 {mom:.1f}점이지만 " + ", ".join(reasons))
        weak = []
        if _valid(fs) and fs < C.FSCORE_WEAK:
            weak.append(f"F-Score {fs}점")
        if _valid(az) and az < C.ALTMAN_DISTRESS:
            weak.append(f"Altman Z {az:.2f}")
        if weak:
            add("theme_hype", "테마 과열 (숫자 없는 스토리)", "danger",
                f"모멘텀 {mom:.1f}점이지만 " + ", ".join(weak))

    if _valid(az) and az < C.ALTMAN_DISTRESS:
        add("bankruptcy", "부실 위험 (Altman Z < 1.81)", "danger", f"Altman Z {az:.2f} — 부실 위험 구간")
    elif _valid(az) and az < C.ALTMAN_SAFE:
        add("grey_zone", "Altman 회색 지대", "info", f"Altman Z {az:.2f} (1.81~2.99)")

    tv, mkt = rec.get("avg_traded_value"), rec.get("market", "US")
    if _valid(tv) and tv < C.MIN_TRADED_VALUE[mkt]:
        add("low_liquidity", "저유동성", "warn",
            f"20일 평균 거래대금 {tv:,.0f} {C.CURRENCY[mkt]} < 기준 {C.MIN_TRADED_VALUE[mkt]:,.0f}")

    if rec.get("above_ma200") is False and rec.get("tier") in (1, 3):
        add("below_ma200", "200일선 이탈", "warn", "추세 훼손 신호 — 모멘텀 기반 비중 점검")
    return flags


def single_condition(rec: dict[str, Any]) -> bool:
    """영상 원칙: 펀더멘털·추세 중 한 가지만 충족한 종목은 신규 매수하지 않는다."""
    return rec.get("tier") in (2, 3)


# ── 적용 ────────────────────────────────────────────────────────────────────
def score_one(rec: dict[str, Any], stats: dict[str, Any]) -> dict[str, Any]:
    fz = _factor_z(rec, stats)
    c_raw, m_raw = _composite_raw(fz), _momentum_raw(rec, stats)
    cz = None if c_raw is None else (c_raw - stats["composite"]["mu"]) / stats["composite"]["sd"]
    mz = None if m_raw is None else (m_raw - stats["momentum"]["mu"]) / stats["momentum"]["sd"]
    rec["factor_z"] = fz
    rec["factor_scores"] = {f: to_score(z) for f, z in fz.items()}
    rec["composite_z"], rec["momentum_z"] = cz, mz
    rec["composite_score"], rec["momentum_score"] = to_score(cz), to_score(mz)
    rec["metric_z"] = {m: metric_z(rec, m, stats) for f in C.FACTORS.values() for m, _ in f}
    rec["tier"] = classify_tier(rec["composite_score"], rec["momentum_score"])
    rec["flags"] = risk_flags(rec)
    rec["single_condition"] = single_condition(rec)
    return rec


def score_basket(records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    stats = fit_stats(records)
    scored = [score_one(r, stats) for r in records]
    # 바스켓 내 순위(백분위)
    comp = sorted(r["composite_score"] for r in scored if r["composite_score"] is not None)
    mom = sorted(r["momentum_score"] for r in scored if r["momentum_score"] is not None)
    for r in scored:
        r["composite_pct"] = _pct(comp, r["composite_score"])
        r["momentum_pct"] = _pct(mom, r["momentum_score"])
    return scored, stats


def _pct(sorted_vals: list[float], v: float | None) -> float | None:
    if v is None or not sorted_vals:
        return None
    return float(np.searchsorted(sorted_vals, v, side="right") / len(sorted_vals))
