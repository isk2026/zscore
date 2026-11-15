"""시장 탭 — 바스켓 시장폭(breadth)과 섹터 주도력 지도(상대 회전 그래프).

바스켓(미국 64 / 한국 44 대형주) 기준이라 시장 전체 지표가 아니다. 가격은 채점 때 받은 캐시를 재사용.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import pandas as pd

from . import config as C
from .data import fetch

log = logging.getLogger(__name__)
QUADRANTS = ("주도", "약화", "소외", "개선")


def close_panel(tickers: list[str]) -> pd.DataFrame:
    cols = {}
    for t in tickers:
        try:
            p = fetch(t).prices
        except Exception as e:  # noqa: BLE001 — 한 종목 실패는 건너뛴다
            log.warning("%s 가격 없음: %s", t, e)
            continue
        if p is None or p.empty:
            continue
        s = p["Close"].dropna()
        idx = pd.DatetimeIndex(s.index)
        s.index = (idx.tz_localize(None) if idx.tz is not None else idx).normalize()
        cols[t] = s[~s.index.duplicated(keep="last")]
    return pd.DataFrame(cols).sort_index().ffill(limit=5)


# ── 시장폭 ────────────────────────────────────────────────────────────────
def _share(cond: pd.DataFrame, valid: pd.DataFrame) -> pd.Series:
    return (cond & valid).sum(axis=1) / valid.sum(axis=1).replace(0, float("nan"))


def zone_of(v: float, prev: str | None = None) -> str:
    lo, hi = C.BREADTH_ZONES
    raw = "약함" if v < lo else "중립" if v < hi else "강함"
    if prev and prev != raw:  # 경계 근처면 이전 구간 유지
        bounds = {("약함", "중립"): lo, ("중립", "약함"): lo, ("중립", "강함"): hi, ("강함", "중립"): hi}
        b = bounds.get((prev, raw))
        if b is not None and abs(v - b) < C.BREADTH_HYSTERESIS:
            return prev
    return raw


def breadth(px: pd.DataFrame, bench: pd.Series) -> dict[str, Any]:
    ma200 = px.rolling(200, min_periods=200).mean()
    ma50 = px.rolling(50, min_periods=50).mean()
    hi = px.rolling(252, min_periods=200).max()
    a200 = _share(px > ma200, ma200.notna())
    a50 = _share(px > ma50, ma50.notna())
    near = _share(px >= hi * C.BREADTH_NEAR_HIGH, hi.notna())
    b = bench.reindex(px.index).ffill()
    df = pd.DataFrame({"a200": a200, "a50": a50, "near": near, "index": b}).dropna().iloc[-C.BREADTH_DAYS:]
    last = df.iloc[-1]
    d = C.DIVERGENCE
    idx_hi = float(b.rolling(252, min_periods=120).max().iloc[-1])
    a50_peak = float(df["a50"].iloc[-d["lookback"]:].max())
    near_hi = bool(last["index"] >= idx_hi * d["index_near_high"])
    return {
        "as_of": df.index[-1].strftime("%Y-%m-%d"),
        "a200": float(last["a200"]), "a50": float(last["a50"]), "near_high": float(last["near"]),
        "a200_3m": float(df["a200"].iloc[-64]) if len(df) > 64 else None,
        "a50_peak": a50_peak, "index_near_high": near_hi, "index_vs_high": float(last["index"]) / idx_hi,
        "divergence": near_hi and bool(last["a50"] <= a50_peak - d["drop"]),
        "zone": zone_of(float(last["a200"])),
        "series": {
            "d": [x.strftime("%Y-%m-%d") for x in df.index],
            "a200": [round(float(x), 4) for x in df["a200"]],
            "a50": [round(float(x), 4) for x in df["a50"]],
            "near": [round(float(x), 4) for x in df["near"]],
            "index": [round(float(x / df["index"].iloc[0]), 4) for x in df["index"]],
        },
    }


# ── 섹터 주도력 (상대 회전 그래프) ─────────────────────────────────────────
def quadrant(ratio: float, mom: float) -> str:
    if ratio >= 100:
        return "주도" if mom >= 100 else "약화"
    return "개선" if mom >= 100 else "소외"


def rrg(px: pd.DataFrame, bench: pd.Series, members: list[str]) -> dict[str, Any] | None:
    cols = [t for t in members if t in px]
    if not cols:
        return None
    ret = px[cols].pct_change(fill_method=None).mean(axis=1, skipna=True).fillna(0)
    rs = ((1 + ret).cumprod() / bench.reindex(px.index).ffill()).dropna()
    wk = rs.resample("W-FRI").last().dropna()
    if len(wk) and wk.index[-1] > px.index[-1]:  # 아직 끝나지 않은 주는 제외 → 판정은 주 1회
        wk = wk.iloc[:-1]
    g = C.RRG
    ratio = 100 * wk / wk.rolling(g["ma_weeks"]).mean()
    mom = 100 * ratio / ratio.shift(g["mom_weeks"])
    df = pd.DataFrame({"r": ratio, "m": mom}).dropna().iloc[-g["tail"]:]
    if df.empty:
        return None
    r, m = float(df["r"].iloc[-1]), float(df["m"].iloc[-1])
    return {
        "week": df.index[-1].strftime("%Y-%m-%d"), "ratio": r, "mom": m, "quadrant": quadrant(r, m),
        "tail": [[x.strftime("%m-%d"), round(float(a), 3), round(float(b), 3)] for x, a, b in df.itertuples()],
    }


def _avg(rs: list[dict], k: str) -> float | None:
    v = [r[k] for r in rs if r.get(k) is not None]
    return sum(v) / len(v) if v else None


def _group_stats(rs: list[dict]) -> dict[str, Any]:
    n = len(rs)
    return {
        "n": n, "t1_share": sum(r["tier"] == 1 for r in rs) / n,
        "composite": _avg(rs, "composite_score"), "momentum": _avg(rs, "momentum_score"),
        "ret_3m": _avg(rs, "ret_3m"),
        "near_high": sum((r.get("high52_ratio") or 0) >= C.BREADTH_NEAR_HIGH for r in rs) / n,
        "above_ma200": sum(bool(r.get("above_ma200")) for r in rs) / n,
        "members": [[r["ticker"], r["name"], r["tier"]] for r in sorted(rs, key=lambda r: (r["tier"], r["name"]))],
    }


def sector_map(stocks: dict[str, dict], px: pd.DataFrame, bench: pd.Series) -> list[dict[str, Any]]:
    by: dict[str, list[dict]] = {}
    for r in stocks.values():
        by.setdefault(r.get("sector") or "기타", []).append(r)
    groups: list[tuple[str, str, list[dict]]] = []
    other: list[dict] = []
    for sec, rs in by.items():
        if len(rs) >= C.RRG["min_members"] and sec != "기타":
            groups.append(("sector", C.SECTOR_KO.get(sec, sec), rs))
        else:
            other += rs
    if len(other) >= C.RRG["min_members"]:
        groups.append(("sector", "기타 (소수 섹터)", other))
    for c in C.FENCE["clusters"]:
        rs = [r for r in stocks.values() if r.get("industry") in c["industries"]]
        if len(rs) >= C.RRG["min_members"]:
            groups.append(("cluster", c["name"], rs))
    out = []
    for kind, name, rs in groups:
        rot = rrg(px, bench, [r["ticker"] for r in rs])
        if rot:
            out.append({"kind": kind, "name": name, **rot, **_group_stats(rs)})
    return sorted(out, key=lambda g: (g["kind"], QUADRANTS.index(g["quadrant"]), -g["ratio"]))


def build(market: str, stocks: dict[str, dict], bench: pd.Series, t1_counts: list) -> dict[str, Any]:
    px = close_panel(list(stocks))
    view = {"breadth": breadth(px, bench), "sectors": sector_map(stocks, px, bench), "t1_counts": t1_counts}
    prev = read_state().get(market, {})
    if prev.get("zone"):  # 화면과 알림이 같은 구간(이력 고려)을 쓰게
        view["breadth"]["zone"] = zone_of(view["breadth"]["a200"], prev["zone"])
    return view


# ── 상태 비교 → 알림 문구 (CI --track 전용) ────────────────────────────────
def read_state() -> dict:
    p = C.MARKET_STATE_PATH
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def update_state(market: str, view: dict[str, Any]) -> list[str]:
    """직전 상태와 비교해 바뀐 점을 텔레그램 HTML 줄로 돌려준다. 첫 실행은 기준선(알림 없음)."""
    state = read_state()
    prev = state.get(market)
    b = view["breadth"]
    cur = {
        "as_of": b["as_of"], "zone": b["zone"], "divergence": b["divergence"], "a200": b["a200"],
        "quadrants": {g["name"]: g["quadrant"] for g in view["sectors"]},
        "week": max((g["week"] for g in view["sectors"]), default=None),
    }
    lines: list[str] = []
    if prev:
        if cur["divergence"] and not prev.get("divergence"):
            lines.append(f"⚠️ <b>시장폭 괴리</b>: 지수는 52주 고점의 {b['index_vs_high']:.0%} 인데 "
                         f"50일선 위 종목 {b['a50']:.0%} (최근 3개월 고점 {b['a50_peak']:.0%})")
        elif prev.get("divergence") and not cur["divergence"]:
            lines.append("✅ 시장폭 괴리 해소")
        if prev.get("zone") and cur["zone"] != prev["zone"]:
            lines.append(f"📊 200일선 위 종목 {prev.get('a200', 0):.0%} → {b['a200']:.0%} "
                         f"(<b>{prev['zone']} → {cur['zone']}</b>)")
        if cur["week"] and cur["week"] != prev.get("week"):
            for name, q in cur["quadrants"].items():
                pq = prev.get("quadrants", {}).get(name)
                if pq and pq != q:
                    lines.append(f"🧭 {name}: {pq} → <b>{q}</b>")
        else:  # 같은 주 재실행: 섹터 비교 기준 유지
            cur["quadrants"] = prev.get("quadrants", cur["quadrants"])
            cur["week"] = prev.get("week", cur["week"])
    state[market] = cur
    C.MARKET_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    C.MARKET_STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
    return lines
