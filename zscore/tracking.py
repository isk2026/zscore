"""② Tier 변화 추적 · ③ 실전 기록(가상 포트폴리오) — CI 에서 export --track 으로만 갱신.

tier_history.json   {market: {"snapshots": {as_of: {ticker: [tier, [위험 키...]]}}, "notified": as_of}}
tier_changes.csv    date,market,ticker,name,from,to,kind
live_record.json    시장별 모델/Tier1/동일가중/지수 NAV (월 1회 리밸런싱, 매 기준일 시가평가)

같은 기준일로 다시 돌면 스냅샷·NAV 를 덮어쓰고 알림은 다시 보내지 않는다.
"""

from __future__ import annotations

import csv
import json
import logging
from html import escape
from typing import Any

from . import config as C

log = logging.getLogger(__name__)
DANGER = {"momentum_crash", "theme_hype", "bankruptcy"}


def _read(path, default):
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def _write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")


# ── ② 등급 변화 ─────────────────────────────────────────────────────────────
def snapshot(stocks: dict[str, dict]) -> dict[str, list]:
    return {t: [r["tier"], sorted(f["key"] for f in r.get("flags", []) if f["key"] in DANGER)]
            for t, r in stocks.items()}


def diff(prev: dict[str, list], cur: dict[str, list], names: dict[str, str]) -> list[dict[str, Any]]:
    out = []
    for t, (tier, flags) in cur.items():
        if t not in prev:
            continue  # 새로 추가된 종목은 비교 대상 아님
        p_tier, p_flags = prev[t]
        if tier != p_tier:
            if tier == 1:
                kind = "enter_t1"
            elif p_tier == 1:
                kind = "exit_t1"
            else:
                kind = "up" if tier < p_tier else "down"
            out.append({"ticker": t, "name": names.get(t, t), "from": p_tier, "to": tier, "kind": kind})
        new_flags = sorted(set(flags) - set(p_flags))
        if new_flags:
            out.append({"ticker": t, "name": names.get(t, t), "from": p_tier, "to": tier,
                        "kind": "flag", "flags": new_flags})
    order = {"enter_t1": 0, "exit_t1": 1, "up": 2, "down": 3, "flag": 4}
    return sorted(out, key=lambda x: (order[x["kind"]], x["to"]))


def update_history(market: str, as_of: str, stocks: dict[str, dict]) -> dict[str, Any]:
    """스냅샷 저장 후 직전(다른 기준일) 대비 변화를 돌려준다."""
    hist = _read(C.TIER_HISTORY_PATH, {})
    h = hist.setdefault(market, {"snapshots": {}, "notified": None})
    snaps = h["snapshots"]
    snaps[as_of] = snapshot(stocks)
    dates = sorted(snaps)
    for d in dates[: -C.HISTORY_KEEP]:
        del snaps[d]
    dates = sorted(snaps)
    prev_date = dates[-2] if len(dates) >= 2 else None
    names = {t: r["name"] for t, r in stocks.items()}
    changes = diff(snaps[prev_date], snaps[as_of], names) if prev_date else []
    is_new = h.get("notified") != as_of
    if is_new and changes:
        new_file = not C.TIER_CHANGES_CSV.exists()
        with C.TIER_CHANGES_CSV.open("a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new_file:
                w.writerow(["date", "market", "ticker", "name", "from", "to", "kind", "flags"])
            for c in changes:
                w.writerow([as_of, market, c["ticker"], c["name"], c["from"], c["to"], c["kind"],
                            "|".join(c.get("flags", []))])
    _write(C.TIER_HISTORY_PATH, hist)
    return {"as_of": as_of, "prev": prev_date, "items": changes, "is_new": is_new}


def mark_notified(market: str, as_of: str) -> None:
    hist = _read(C.TIER_HISTORY_PATH, {})
    if market in hist:
        hist[market]["notified"] = as_of
        _write(C.TIER_HISTORY_PATH, hist)


def last_changes(market: str, names: dict[str, str]) -> dict[str, Any]:
    """저장된 이력의 마지막 두 기준일 비교 (읽기 전용)."""
    snaps = _read(C.TIER_HISTORY_PATH, {}).get(market, {}).get("snapshots", {})
    dates = sorted(snaps)
    if len(dates) < 2:
        return {"as_of": dates[-1] if dates else None, "prev": None, "items": []}
    return {"as_of": dates[-1], "prev": dates[-2], "items": diff(snaps[dates[-2]], snaps[dates[-1]], names)}


def timelines(market: str) -> dict[str, Any]:
    """종목별 최근 TIMELINE_DAYS 기준일의 등급 문자열 (예: '1112223', 결측은 '-')."""
    snaps = _read(C.TIER_HISTORY_PATH, {}).get(market, {}).get("snapshots", {})
    dates = sorted(snaps)[-C.TIMELINE_DAYS:]
    tickers = {t for d in dates for t in snaps[d]}
    return {"dates": dates,
            "tiers": {t: "".join(str(snaps[d][t][0]) if t in snaps[d] else "-" for d in dates) for t in tickers}}


# ── ③ 실전 기록 ─────────────────────────────────────────────────────────────
def _value(pos: dict[str, dict], prices: dict[str, float]) -> float:
    """기준 시점 1 대비 현재 가치 (현금 수익 0)."""
    w_sum = sum(p["w"] for p in pos.values())
    v = 1 - w_sum
    for t, p in pos.items():
        px = prices.get(t) or p.get("last") or p["p"]
        p["last"] = px
        v += p["w"] * px / p["p"]
    return v


def update_live(market: str, as_of: str, stocks: dict[str, dict], model: dict[str, Any],
                index_price: float) -> dict[str, Any]:
    rec = _read(C.LIVE_RECORD_PATH, {})
    m = rec.setdefault(market, {"start": as_of, "nav": [], "rebalances": [], "state": None})
    prices = {t: r["price"] for t, r in stocks.items() if r.get("price")}
    for h in model["holdings"]:
        if h.get("price"):
            prices.setdefault(h["ticker"], h["price"])

    def targets() -> dict[str, dict[str, dict]]:
        t1 = [t for t, r in stocks.items() if r["tier"] == 1]
        return {
            "model": {h["ticker"]: {"w": h["weight"], "p": prices[h["ticker"]], "tier": h["tier"]}
                      for h in model["holdings"] if h["ticker"] in prices},
            "t1": {t: {"w": 1 / len(t1), "p": prices[t]} for t in t1 if t in prices} if t1 else {},
            "ew": {t: {"w": 1 / len(prices), "p": p} for t, p in prices.items()},
        }

    st = m["state"]
    if st and st["base_date"] > as_of:
        return m  # 과거 기준일로 되돌아가는 일은 무시
    navs = {}
    if st:
        for k in ("model", "t1", "ew"):
            navs[k] = st["base_nav"][k] * _value(st["pos"][k], prices)
        navs["index"] = st["base_nav"]["index"] * index_price / st["index_p"]
    else:
        navs = {"model": 1.0, "t1": 1.0, "ew": 1.0, "index": 1.0}

    rebalance = st is None or as_of[:7] != st["base_date"][:7]
    if rebalance:
        new = targets()
        turnover = {}
        for k in ("model", "t1", "ew"):
            old = {}
            if st:  # 보유 기간 동안 가격 변동으로 흘러간 현재 비중
                v = _value(st["pos"][k], prices)
                old = {t: p["w"] * p["last"] / p["p"] / v for t, p in st["pos"][k].items()}
            to = 0.5 * sum(abs(new[k].get(t, {}).get("w", 0) - old.get(t, 0)) for t in set(new[k]) | set(old))
            if st:  # 첫 편입은 현금→주식 매수만 비용
                navs[k] *= 1 - 2 * to * C.BACKTEST_COST
            else:
                navs[k] *= 1 - sum(p["w"] for p in new[k].values()) * C.BACKTEST_COST
            turnover[k] = to
        m["state"] = {"base_date": as_of, "base_nav": dict(navs), "index_p": index_price, "pos": new}
        m["rebalances"].append({
            "date": as_of, "regime": model.get("regime"), "equity_weight": model["equity_weight"],
            "cash": 1 - sum(p["w"] for p in new["model"].values()), "turnover": turnover.get("model"),
            "holdings": {t: {"w": round(p["w"], 4), "p": p["p"], "tier": p.get("tier")} for t, p in new["model"].items()},
        })
        log.info("%s 실전 기록 리밸런싱: %s (%d종목)", market, as_of, len(new["model"]))

    row = {"date": as_of, **{k: round(v, 6) for k, v in navs.items()}}
    if m["nav"] and m["nav"][-1]["date"] == as_of:
        m["nav"][-1] = row
    else:
        m["nav"].append(row)
    _write(C.LIVE_RECORD_PATH, rec)
    return m


def publish_live() -> None:
    """대시보드용 사본 (state 의 내부 가격 포함 그대로 — 작다)."""
    rec = _read(C.LIVE_RECORD_PATH, {})
    if rec:
        C.LIVE_PUBLIC_PATH.write_text(json.dumps(rec, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


# ── 알림 문구 (텔레그램 HTML) ──────────────────────────────────────────────
KIND_LABEL = {"enter_t1": "🟢 Tier 1 진입", "exit_t1": "🔻 Tier 1 이탈", "up": "⬆️ 등급 상향",
              "down": "⬇️ 등급 하향", "flag": "⚠️ 새 위험 경고"}
FLAG_LABEL = {"momentum_crash": "모멘텀 크러시", "theme_hype": "테마 과열", "bankruptcy": "부실 위험"}
MARKET_LABEL = {"US": "🇺🇸 미국", "KR": "🇰🇷 한국"}


def alert_html(market: str, changes: dict[str, Any], macro: dict[str, Any],
               rebalanced: dict[str, Any] | None) -> str:
    lines = [f"<b>주도주 스코어 · {MARKET_LABEL[market]}</b> ({changes['as_of']}, 직전 {changes['prev']})"]
    if macro.get("available"):
        lines.append(f"국면 {macro['regime']} <i>{escape(macro['regime_name'] or '')}</i> · "
                     f"주식 비중 {macro['equity_weight']:.0%}")
    groups: dict[str, list[str]] = {}
    for c in changes["items"]:
        s = f"{escape(c['name'])} T{c['from']}→T{c['to']}" if c["kind"] != "flag" else \
            f"{escape(c['name'])} (T{c['to']}): " + ", ".join(FLAG_LABEL.get(f, f) for f in c["flags"])
        groups.setdefault(c["kind"], []).append(s)
    for kind, label in KIND_LABEL.items():
        if kind in groups:
            lines.append(f"\n<b>{label}</b>\n" + "\n".join(f"• {x}" for x in groups[kind]))
    if rebalanced:
        r = rebalanced
        lines.append(f"\n<b>📒 실전 기록 월간 리밸런싱</b> — {len(r['holdings'])}종목, 현금 {r['cash']:.0%}")
    lines.append(f'\n<a href="{C.DASHBOARD_URL}">대시보드 열기</a>')
    return "\n".join(lines)
