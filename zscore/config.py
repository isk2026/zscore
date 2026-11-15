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
# 유니버스 밖 추가 종목 — 바스켓 통계에는 영향 없이 같은 기준으로 채점 (휴대폰 Run workflow 로 추가)
EXTRA_TICKERS_PATH = ROOT / "data" / "extra_tickers.txt"

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

PRICE_HISTORY_PERIOD = "5y"   # 백테스트(재무 4년 + 12-1M 계산용 1년)까지 커버
CHART_DAYS = 260
FETCH_WORKERS = 8
CACHE_HOURS = 12

# ── 백테스트 ────────────────────────────────────────────────────────────────
BACKTEST_PATH = ROOT / "dashboard" / "public" / "data" / "backtest.json"
REPORT_LAG_DAYS = 90        # 회계연도 종료 후 이 기간이 지나야 해당 연간 재무를 "알았다"고 본다
BACKTEST_COST = 0.001       # 편도 거래비용 10bp
BACKTEST_MIN_COVERAGE = 0.7 # 바스켓의 70% 이상이 재무를 가진 첫 월말부터 시작

# ── ① Beta Model 연동: 시장 국면 → 주식 비중 → Tier 예산 ───────────────────
BETA_MODEL_URL = "https://isk2026.github.io/beta-model/data/beta_model.json"
BETA_MODEL_LOCAL = ROOT.parent / "Beta Model" / "dashboard" / "public" / "data" / "beta_model.json"
BETA_FALLBACK_EQUITY = 0.80   # Beta Model 을 못 읽으면 쓰는 주식 비중
# 주식 몫 안에서 Tier 별 예산. 영상 원칙: 모멘텀 주도주(T3)는 추세가 꺾이면 가장 먼저 축소,
# 공포 국면은 깊게 빠진 우량주(펀더멘털) 매수 기회 → T2 비중 확대
TIER_BUDGET_BY_REGIME = {
    1: {1: 0.70, 2: 0.15, 3: 0.15},   # 상승 따라가기
    2: {1: 0.75, 2: 0.25, 3: 0.00},   # 미리 줄이기
    3: {1: 0.60, 2: 0.40, 3: 0.00},   # 하락 방어
    4: {1: 0.50, 2: 0.50, 3: 0.00},   # 최대 방어 / 공포
}
MODEL_TOP_N = {1: 10, 2: 5, 3: 5}     # Tier 안에서 (종합+모멘텀) 상위 N 종목만
MODEL_EXCLUDE_FLAGS = {"momentum_crash", "theme_hype", "bankruptcy", "low_liquidity"}

# ── ②③ 추적 (CI 에서만 --track) ─────────────────────────────────────────────
TIER_HISTORY_PATH = ROOT / "data" / "tier_history.json"
TIER_CHANGES_CSV = ROOT / "data" / "tier_changes.csv"
LIVE_RECORD_PATH = ROOT / "data" / "live_record.json"
LIVE_PUBLIC_PATH = ROOT / "dashboard" / "public" / "data" / "live.json"
ALERT_PATH = ROOT / "data" / "alert_pending.html"   # notify 단계가 보내고 지운다 (git 제외)
HISTORY_KEEP = 260            # 시장별 보관 스냅샷 수 (약 1년)
TIMELINE_DAYS = 60            # 종목 화면의 등급 타임라인 길이
DASHBOARD_URL = "https://isk2026.github.io/zscore/"

# ── 시장 탭: 바스켓 시장폭 · 섹터 주도력 지도 ──────────────────────────────
BREADTH_DAYS = 260                 # 차트에 보낼 일수
BREADTH_NEAR_HIGH = 0.95           # 52주 고점 5% 이내
BREADTH_ZONES = (0.40, 0.60)       # 200일선 위 비율: <40% 약함 · 40~60% 중립 · ≥60% 강함
BREADTH_HYSTERESIS = 0.03          # 경계 깜빡임 방지 (구간 전환은 경계 ±3%p 를 넘어야)
# 지수 ≥ 52주 고점×97% 인데 50일선 위 비율이 최근 63거래일 고점보다 15%p 이상 낮으면 '시장폭 괴리'
DIVERGENCE = {"index_near_high": 0.97, "drop": 0.15, "lookback": 63}
# RS = 섹터 동일가중 지수 / 시장 지수 (주간, 완료된 주만)
# RS-Ratio = 100 × RS / RS 10주 평균 · RS-Momentum = 100 × Ratio / 4주 전 Ratio
RRG = {"ma_weeks": 10, "mom_weeks": 4, "tail": 8, "min_members": 3}
MARKET_STATE_PATH = ROOT / "data" / "market_state.json"

# ── 울타리 탭: 포트폴리오 위험 (상관·변동성·베타·과거 하락장·환율) ───────────
RISK_PATH = ROOT / "dashboard" / "public" / "data" / "risk.json"
RISK_WEEKS = 104                   # 주간 수익률 2년 (한국·미국 장 마감 시차를 피하려고 일간 대신 주간)
FX_SYMBOL = "KRW=X"                # USD/KRW
CORR_CLUSTER = 0.60                # 평균 상관 ≥ 0.6 인 종목끼리 '사실상 같은 베팅'으로 묶는다
STRESS_WINDOWS = [                 # 과거 하락 구간 재현 (시작 전날 종가 → 종료일 종가)
    {"name": "2022 금리 인상 하락장", "start": "2022-01-03", "end": "2022-10-12"},
    {"name": "2024-08 엔캐리 청산", "start": "2024-07-31", "end": "2024-08-05"},
    {"name": "2025-04 관세 충격", "start": "2025-04-02", "end": "2025-04-08"},
]
# + 시장별 '최근 1년 지수 최대 낙폭 구간' 을 자동으로 추가

# ── 수급 (표시 전용 — 점수에는 넣지 않는다: 백테스트로 효과 확인 전) ─────────
FLOWS_DAYS = 20                    # 한국: 외국인·기관 순매수 합산 기간 (거래일)
FLOWS_URL = "https://m.stock.naver.com/api/stock/{code}/trend?pageSize=30"
SHORT_HIGH = 0.10                  # 미국: 유통주식 대비 공매도 ≥ 10% → 공매도 비중 높음
SHORT_CHANGE = 0.20                # 미국: 공매도 잔고 전월 대비 ±20% → 급증 / 감소

# ── '왜 이 등급인가' 요약 · 데이터 신뢰도 ────────────────────────────────────
WHY_STRONG_Z = 0.5                 # 팩터 z ≥ 0.5 (약 상위 30%) → 강점으로 언급
WHY_WEAK_Z = -0.5
METRIC_LABELS = {
    "fcf_to_assets": ("FCF/총자산", "pct"), "ocf_to_assets": ("영업CF/총자산", "pct"),
    "accruals": ("발생액/총자산", "pct"), "revenue_growth": ("매출 성장률", "pct"),
    "earnings_growth": ("순이익 성장률", "pct"), "roe": ("ROE", "pct"), "roa": ("ROA", "pct"),
    "gross_margin": ("매출총이익률", "pct"), "fscore": ("F-Score", "int"),
    "altman_z_capped": ("Altman Z", "n"), "debt_to_equity": ("부채/자본", "n"),
    "earnings_yield": ("이익수익률", "pct"), "fcf_yield": ("FCF 수익률", "pct"),
    "book_to_price": ("B/P", "n"), "ret_12_1": ("12-1M 수익률", "pct"),
    "high52_ratio": ("52주 고점 대비", "plain"), "rel_strength": ("6M 상대강도", "pct"),
    "eps_revision": ("EPS 추정치 30일 변화", "pct"),
}
STALE_PRICE_DAYS = 5               # 바스켓 기준일보다 가격이 5일 넘게 오래되면 경고
STALE_FY_DAYS = 456                # 최근 회계연도 종료가 15개월 넘게 지났으면 경고
DATA_STALE_HOURS = 72             # 대시보드 데이터가 72시간 넘게 갱신 안 되면 상단 경고 (주말 공백 고려)
SECTOR_KO = {
    "Technology": "기술", "Consumer Cyclical": "경기소비재", "Healthcare": "헬스케어",
    "Financial Services": "금융", "Industrials": "산업재", "Communication Services": "커뮤니케이션",
    "Utilities": "유틸리티", "Consumer Defensive": "필수소비재", "Energy": "에너지",
    "Basic Materials": "소재", "Real Estate": "부동산",
}
