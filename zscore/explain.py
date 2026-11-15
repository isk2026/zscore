"""'왜 이 등급인가' 한 줄 요약과 데이터 신뢰도 — 채점 결과(팩터 z·지표 z)만으로 만든다."""

from __future__ import annotations

import math
import time
from datetime import datetime
from typing import Any

from . import config as C


def top_share(z: float) -> float:
    """정규분포 가정에서 z 보다 위에 있는 비율 (상위 몇 %)."""
    return 1 - 0.5 * (1 + math.erf(z / math.sqrt(2)))


def _fmt(v: float, kind: str) -> str:
    if kind == "pct":
        return f"{v * 100:+.0f}%"
    if kind == "plain":
        return f"{v * 100:.0f}%"
    if kind == "int":
        return f"{v:.0f}"
    return f"{v:.2f}"


def _rank(z: float) -> str:
    p = top_share(z)
    return f"상위 {max(p, 0.01):.0%}" if p <= 0.5 else f"하위 {max(1 - p, 0.01):.0%}"


def _metric_phrase(rec: dict, m: str, z: float) -> str:
    label, kind = C.METRIC_LABELS[m]
    v = rec.get(m)
    val = f" {_fmt(v, kind)}" if v is not None else ""
    return f"{label}{val}({_rank(z)})"


def _dir_metric_z(rec: dict, factor: str) -> list[tuple[str, float]]:
    mz = rec.get("metric_z") or {}
    fin = rec.get("sector") in C.FINANCIAL_SECTORS
    return [(m, d * mz[m]) for m, d in C.FACTORS[factor]
            if mz.get(m) is not None and not (fin and m in C.FINANCIAL_SKIP)]


def why(rec: dict[str, Any]) -> dict[str, Any]:
    c, m, tier = rec.get("composite_score"), rec.get("momentum_score"), rec.get("tier")
    labels = C.FACTOR_LABELS
    fz = {f: z for f, z in (rec.get("factor_z") or {}).items() if z is not None and f != "momentum"}
    strong = sorted(((f, z) for f, z in fz.items() if z >= C.WHY_STRONG_Z), key=lambda x: -x[1])[:2]
    weak = sorted(((f, z) for f, z in fz.items() if z <= C.WHY_WEAK_Z), key=lambda x: x[1])[:1]
    s_txt = "·".join(f"{labels[f]} {_rank(z)}" for f, z in strong)
    w_fund = f"{labels[weak[0][0]]} {_rank(weak[0][1])}" if weak else None
    mom = sorted(_dir_metric_z(rec, "momentum"), key=lambda x: x[1])
    mom_weak = _metric_phrase(rec, *mom[0]) if mom else None
    mom_strong = _metric_phrase(rec, *mom[-1]) if mom else None

    if c is None or m is None:
        line = "자료 부족으로 두 축 중 하나를 계산하지 못했습니다"
    elif tier == 1:
        line = f"{s_txt or '펀더멘털 평균 이상'} + {mom_strong or '추세 양호'} → 두 축 모두 충족, Tier 1"
    elif tier == 2:
        line = f"{s_txt or '펀더멘털 평균 이상'}이지만 {mom_weak or '모멘텀 부족'}로 추세 미확인 → Tier 2"
    elif tier == 3:
        line = f"{mom_strong or '추세 강함'}로 추세는 강하지만 {w_fund or '펀더멘털 평균 미만'} → Tier 3"
    else:
        line = f"{w_fund or '펀더멘털 평균 미만'} · {mom_weak or '추세 약함'} → 두 축 모두 미달, Tier 4"

    rule = (f"종합 {c:.2f} {'≥' if c >= C.TIER_COMPOSITE else '<'} {C.TIER_COMPOSITE} · "
            f"모멘텀 {m:.2f} {'≥' if m >= C.TIER_MOMENTUM else '<'} {C.TIER_MOMENTUM}"
            + (f" (Tier 3 기준 {C.TIER3_MOMENTUM})" if c < C.TIER_COMPOSITE else "")) if c is not None and m is not None else None
    notes = []
    danger = [f["title"] for f in rec.get("flags", []) if f.get("level") == "danger"]
    if danger:
        notes.append("⚠ " + " · ".join(danger))
    fl = rec.get("flows")
    if fl and m is not None and m >= C.TIER_MOMENTUM and fl.get("tone") == "bad":
        notes.append(f"모멘텀은 높지만 수급은 '{fl['signal']}' — 추세의 질 확인 필요")
    elif fl and m is not None and m < C.TIER_MOMENTUM and fl.get("tone") == "good":
        notes.append(f"모멘텀은 낮지만 수급은 '{fl['signal']}' — 추세 전환 초기일 수 있음")
    return {"line": line, "rule": rule, "notes": notes}


def quality(rec: dict[str, Any], basket_as_of: str | None) -> dict[str, Any]:
    fin = rec.get("sector") in C.FINANCIAL_SECTORS
    metrics = [m for items in C.FACTORS.values() for m, _ in items if not (fin and m in C.FINANCIAL_SKIP)]
    if fin:
        metrics = [m for m in metrics if m != "altman_z_capped"]
    missing = [m for m in metrics if rec.get(m) is None]
    warn = []
    if basket_as_of and rec.get("as_of"):
        lag = (datetime.fromisoformat(basket_as_of) - datetime.fromisoformat(rec["as_of"])).days
        if lag > C.STALE_PRICE_DAYS:
            warn.append(f"가격이 바스켓 기준일보다 {lag}일 오래됨")
    fy = rec.get("fy_end")
    if fy and basket_as_of and (datetime.fromisoformat(basket_as_of) - datetime.fromisoformat(fy)).days > C.STALE_FY_DAYS:
        warn.append(f"최근 연간 재무가 {fy} 결산 — 새 결산 미반영")
    if len(missing) > len(metrics) / 3:
        warn.append(f"지표 {len(missing)}개 결측 — 점수 신뢰도 낮음")
    return {
        "available": len(metrics) - len(missing), "total": len(metrics),
        "missing": [C.METRIC_LABELS[m][0] for m in missing],
        "fy_end": fy, "price_as_of": rec.get("as_of"), "fetched_at": rec.get("fetched_at"), "warn": warn,
    }


def attach(records: list[dict[str, Any]], basket_as_of: str | None) -> None:
    for r in records:
        r["why"] = why(r)
        r["quality"] = quality(r, basket_as_of)


def fetched_iso(ts: float) -> str | None:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)) if ts else None
