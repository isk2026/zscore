"""모든 파라미터 — 유니버스, 팩터 가중치, 등급 임계값, 함정 규칙, 포트폴리오 울타리.

점수 체계
---------
각 원지표는 시장 바스켓(미국/한국 각각) 안에서 윈저라이즈(5~95%) 후 Z-Score로 표준화한다.
팩터 점수 = 소속 지표 Z의 평균, 종합/모멘텀 = 팩터 가중합을 다시 바스켓 내 표준화한 값 z.
화면 점수 = clip(3 + z, 1, 5)  →  3.0 = 바스켓 평균, 3.5 = 상위 약 30%, 4.0 = 상위 약 16%.
(원 프롬프트의 "종합 ≥ 3.0" 은 Z 그 자체라면 상위 0.1% 라 의미가 없으므로 1~5 척도로 해석)
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "data" / "cache"
EXPORT_PATH = ROOT / "dashboard" / "public" / "data" / "screener.json"

# ── 유니버스: 표준화 기준이 되는 동종 바스켓 ────────────────────────────────
# 한국은 yfinance 영문 약칭이 읽기 어려워 이름을 직접 둔다.
UNIVERSE: dict[str, dict[str, str | None]] = {
    "US": {t: None for t in [
        # 반도체·하드웨어
        "NVDA", "AVGO", "AMD", "MRVL", "MU", "QCOM", "TXN", "AMAT", "LRCX", "KLAC", "ARM", "INTC",
        "ANET", "SMCI", "DELL", "AAPL",
        # 소프트웨어·인터넷
        "MSFT", "GOOGL", "META", "AMZN", "ORCL", "CRM", "ADBE", "NOW", "PLTR", "SNOW", "CRWD",
        "PANW", "NFLX", "UBER", "SHOP",
        # 소비·자동차
        "TSLA", "COST", "WMT", "HD", "NKE", "MCD", "SBUX", "GM", "F",
        # 헬스케어
        "LLY", "UNH", "JNJ", "ABBV", "MRK", "PFE", "ISRG", "VRTX",
        # 금융
        "JPM", "BAC", "GS", "V", "MA", "BRK-B",
        # 산업·에너지·유틸리티
        "GE", "CAT", "RTX", "LMT", "BA", "XOM", "CVX", "NEE", "VST", "CEG",
    ]},
    "KR": {
        "005930.KS": "삼성전자", "000660.KS": "SK하이닉스", "042700.KS": "한미반도체",
        "009150.KS": "삼성전기", "000990.KS": "DB하이텍",
        "005380.KS": "현대차", "000270.KS": "기아", "012330.KS": "현대모비스",
        "373220.KS": "LG에너지솔루션", "006400.KS": "삼성SDI", "051910.KS": "LG화학",
        "003670.KS": "포스코퓨처엠", "005490.KS": "POSCO홀딩스",
        "207940.KS": "삼성바이오로직스", "068270.KS": "셀트리온", "128940.KS": "한미약품",
        "035420.KS": "NAVER", "035720.KS": "카카오", "259960.KS": "크래프톤", "036570.KS": "엔씨소프트",
        "012450.KS": "한화에어로스페이스", "064350.KS": "현대로템", "047810.KS": "한국항공우주",
        "079550.KS": "LIG넥스원",
        "329180.KS": "HD현대중공업", "009540.KS": "HD한국조선해양", "010140.KS": "삼성중공업",
        "267260.KS": "HD현대일렉트릭", "010120.KS": "LS ELECTRIC", "034020.KS": "두산에너빌리티",
        "105560.KS": "KB금융", "055550.KS": "신한지주", "086790.KS": "하나금융지주",
        "032830.KS": "삼성생명", "000810.KS": "삼성화재",
        "017670.KS": "SK텔레콤", "030200.KS": "KT", "033780.KS": "KT&G",
        "015760.KS": "한국전력", "096770.KS": "SK이노베이션", "011200.KS": "HMM",
        "247540.KQ": "에코프로비엠", "086520.KQ": "에코프로", "196170.KQ": "알테오젠",
    },
}

BENCHMARK = {"US": "^GSPC", "KR": "^KS11"}
CURRENCY = {"US": "USD", "KR": "KRW"}

# 저유동성: 20일 평균 거래대금 하한 (현지 통화)
MIN_TRADED_VALUE = {"US": 20_000_000, "KR": 5_000_000_000}

# 금융업은 Altman Z(제조업 모형)가 의미 없으므로 계산하지 않는다
FINANCIAL_SECTORS = {"Financial Services", "Financials"}
# 금융업은 예금·대출이 현금흐름/부채로 잡혀 아래 지표가 업종 특성일 뿐이므로 채점에서 뺀다
FINANCIAL_SKIP = {"fcf_to_assets", "ocf_to_assets", "accruals", "fcf_yield", "debt_to_equity",
                  "gross_margin", "roa"}

# ── 팩터: (지표, 방향) — 방향 -1 은 낮을수록 좋음 ───────────────────────────
FACTORS: dict[str, list[tuple[str, int]]] = {
    "cashflow": [("fcf_to_assets", 1), ("ocf_to_assets", 1), ("accruals", -1)],
    "growth": [("revenue_growth", 1), ("earnings_growth", 1)],
    "profitability": [("roe", 1), ("roa", 1), ("gross_margin", 1)],
    "stability": [("fscore", 1), ("altman_z_capped", 1), ("debt_to_equity", -1)],
    "valuation": [("earnings_yield", 1), ("fcf_yield", 1), ("book_to_price", 1)],
    "momentum": [("ret_12_1", 1), ("high52_ratio", 1), ("rel_strength", 1), ("eps_revision", 1)],
}

FACTOR_LABELS = {
    "cashflow": "현금흐름", "growth": "성장", "profitability": "수익성",
    "stability": "재무안정", "valuation": "밸류에이션", "momentum": "모멘텀",
}

# 종합 점수 = 펀더멘털 팩터 가중합 (영상의 5개 바텀업 요소 중 가격 모멘텀 제외)
COMPOSITE_WEIGHTS = {
    "cashflow": 0.25, "growth": 0.25, "profitability": 0.20, "stability": 0.20, "valuation": 0.10,
}
# 모멘텀 점수 = 모멘텀 팩터 내부 가중
MOMENTUM_WEIGHTS = {"ret_12_1": 0.35, "high52_ratio": 0.25, "rel_strength": 0.15, "eps_revision": 0.25}

WINSOR = (0.05, 0.95)
SCORE_CENTER, SCORE_MIN, SCORE_MAX = 3.0, 1.0, 5.0

# ── 4-Tier ──────────────────────────────────────────────────────────────────
TIER_COMPOSITE = 3.0
TIER_MOMENTUM = 3.0
TIER3_MOMENTUM = 3.5
TIERS = {
    1: {"name": "핵심 주도주", "en": "Core Leading", "action": "최우선 편입 (비중 상한 8%)", "max_weight": 0.08},
    2: {"name": "펀더멘털 주도주", "en": "Fundamental Leading", "action": "추세 회복 확인 후 비중 확대", "max_weight": 0.05},
    3: {"name": "모멘텀 주도주", "en": "Momentum Leading", "action": "추세 꺾이면 가장 먼저 축소", "max_weight": 0.04},
    4: {"name": "관찰 대상", "en": "Watchlist", "action": "최소 비중 / 회피", "max_weight": 0.02},
}

# ── 위험 필터 ───────────────────────────────────────────────────────────────
ALTMAN_DISTRESS = 1.81
ALTMAN_SAFE = 2.99
FSCORE_STRONG = 7          # 영상: 7점 이상 우량
FSCORE_WEAK = 4            # 테마 과열 판정
VALUE_TRAP_VAL_Z = 0.5     # 밸류에이션 팩터 z ≥ 0.5 → '싸다'
CRASH_DRAWDOWN_3M = -0.30
HYPE_MOMENTUM = 3.5

# ── 포트폴리오 울타리 기본값 (대시보드에서 조정) ─────────────────────────────
FENCE = {
    "stock_max": 0.08, "stock_max_range": [0.02, 0.08],
    "sector_max": 0.35, "sector_max_range": [0.30, 0.35],
    "clusters": [
        {"name": "반도체 체인", "limit": 0.30,
         "industries": ["Semiconductors", "Semiconductor Equipment & Materials", "Consumer Electronics",
                        "Computer Hardware", "Electronic Components"]},
        {"name": "자동차·2차전지", "limit": 0.25,
         "industries": ["Auto Manufacturers", "Auto Parts", "Electrical Equipment & Parts",
                        "Specialty Chemicals"]},
        {"name": "방산·조선", "limit": 0.25,
         "industries": ["Aerospace & Defense", "Marine Shipping", "Specialty Industrial Machinery"]},
    ],
}

PRICE_HISTORY_PERIOD = "2y"
CHART_DAYS = 260
FETCH_WORKERS = 8
CACHE_HOURS = 12
