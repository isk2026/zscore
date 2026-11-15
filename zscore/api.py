"""로컬 분석 서버 — 유니버스 밖 종목을 같은 바스켓 기준으로 즉시 채점.

    uv run uvicorn zscore.api:app --port 8000
    (대시보드 dev 서버가 /api 를 여기로 프록시. 정적 배포본은 API 없이 유니버스만 조회)
"""

from __future__ import annotations

import json
import logging
from typing import Any

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config as C
from . import explain, flows
from .data import fetch, fetch_benchmark, market_of, normalize_ticker
from .export import clean
from .metrics import compute_raw
from .scoring import score_external

log = logging.getLogger("zscore.api")
app = FastAPI(title="Zscore 주도주 분석 API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["GET"], allow_headers=["*"])


def _load() -> dict[str, Any]:
    if not C.EXPORT_PATH.exists():
        raise HTTPException(503, "screener.json 이 없습니다 — 먼저 `python -m zscore.export` 실행")
    return json.loads(C.EXPORT_PATH.read_text(encoding="utf-8"))


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "has_data": C.EXPORT_PATH.exists()}


@app.get("/api/analyze")
def analyze(ticker: str = Query(..., min_length=1), refresh: bool = False) -> dict[str, Any]:
    t = normalize_ticker(ticker)
    mkt = market_of(t)
    data = _load()
    basket = data["markets"].get(mkt)
    if basket is None:
        raise HTTPException(503, f"{mkt} 바스켓 통계가 없습니다")
    if not refresh and t in basket["stocks"]:
        return {"stock": basket["stocks"][t], "in_universe": True}

    raw = fetch(t, refresh=refresh)
    if raw.prices is None:
        raise HTTPException(404, f"{t} 시세를 찾을 수 없습니다")
    rec = compute_raw(raw, fetch_benchmark(mkt), C.UNIVERSE[mkt].get(t))
    rec = score_external(rec, basket["stats"], basket["rows"])
    flows.attach([rec])
    explain.attach([rec], basket.get("as_of"))
    return clean({"stock": rec, "in_universe": t in basket["stocks"]})


@app.get("/api/search")
def search(q: str = Query(..., min_length=1)) -> list[dict[str, Any]]:
    try:
        quotes = yf.Search(q, max_results=8, news_count=0).quotes
    except Exception as e:  # noqa: BLE001 — Yahoo 검색 실패는 빈 결과
        log.warning("search 실패: %s", e)
        return []
    out = []
    for x in quotes:
        sym = x.get("symbol", "")
        if x.get("quoteType") != "EQUITY":
            continue
        if "." in sym and not sym.endswith((".KS", ".KQ")):
            continue  # 미국·한국만
        out.append({"ticker": sym, "name": x.get("shortname") or x.get("longname") or sym,
                    "exchange": x.get("exchDisp") or x.get("exchange")})
    return out
