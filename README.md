# Zscore — 퀀트 주도주 선별 · 위험 관리 대시보드

성상현 「매크로비욘드」 12부 **"2027년 주도주 완전 바뀐다"** 프레임워크 구현
(`Reference.txt`). *주도주는 규칙으로 고르고, 위험은 규칙으로 담으며, 성과는 규칙으로 검증한다.*

```
zscore/                 Python 엔진
  config.py             유니버스 · 팩터 가중치 · Tier 임계값 · 함정 규칙 · 울타리 기본값
  data.py               1단계 yfinance 수집 (미국 + 한국 .KS/.KQ), data/cache 12시간 캐시
  metrics.py            2단계 원지표: Piotroski F · Altman Z · 12-1M · 52주 고점비 · RS · EPS 수정 · 밸류에이션
  scoring.py            3~4단계: 윈저라이즈 → Z-Score → 종합/모멘텀 → 4-Tier → 함정 경고
  export.py             유니버스 채점 → dashboard/public/data/screener.json
  api.py                (선택) 로컬 FastAPI — 유니버스 밖 종목 실시간 채점 + 종목 검색
tests/                  오프라인 단위 테스트 (합성 데이터)
dashboard/              React + Vite + Tailwind 4 + Chart.js + lucide (Beta Model 과 같은 스택)
```

## 실행

```bash
uv sync
uv run python -m zscore.export            # 유니버스 수집·채점 (~1분, 이후 12시간 캐시)
uv run python -m zscore.export --refresh  # 캐시 무시
uv run pytest -q

# 대시보드
cd dashboard && npm install && npm run dev        # http://localhost:5173

# (선택) 임의 종목 실시간 채점 API — 대시보드 dev 서버가 /api 를 프록시
uv run python -m uvicorn zscore.api:app --port 8000
```

> Windows 애플리케이션 제어 정책이 `uvicorn.exe` 를 막으므로 `python -m uvicorn` 으로 실행한다.

화면: **종목 분석**(스코어카드 · Tier 배지 · 6-팩터 레이더 · 가격/200일선/52주 고점 · 함정 경고 · 팩터 분해 · F/Altman 체크리스트),
**스크리너**(4-Tier 매트릭스 산점도 · 정렬 표), **포트폴리오 울타리**(종목·섹터·클러스터·Tier 상한 위반 검사 + 규칙 적용 제안 비중).
URL 로 바로 열기: `?tab=screener&market=KR`, `?tab=stock&ticker=005930.KS`.

## 휴대폰에서 보기 · 실행

- 대시보드: **https://isk2026.github.io/zscore/** — 휴대폰 브라우저 → 공유 → "홈 화면에 추가"하면 앱처럼 열린다 (PWA)
- **재채점 / 종목 추가**: 상단 ▷ **실행** 버튼 → GitHub *Run workflow* 펼치기 →
  `tickers` 에 종목 입력(예: `ASML, TSM, 000100`, 비우면 재채점만) → 초록 *Run workflow* → 약 3~5분 뒤 대시보드 **갱신**
  - 추가 종목은 `data/extra_tickers.txt` 에 남아 이후 매일 같이 갱신된다. 빼려면 `remove` 칸에 입력
  - 추가 종목은 바스켓 통계(μ·σ)에 영향을 주지 않고 같은 기준으로 채점된다 (스크리너 매트릭스에는 안 나오고 검색·포트폴리오에서 조회)
  - 공개 페이지에 쓰기 토큰을 넣을 수 없어 GitHub 실행 페이지로 연결한다 (저장소 주인만 실행 가능)
- 자동 갱신: 평일 16:40 KST(한국 마감 후), 07:20 KST(미국 마감 후). GitHub 예약 실행은 수십 분~수 시간 늦을 수 있다
- 로컬 PC: `uv run python -m zscore.export --add ASML` 로도 추가 가능

## 점수 체계

| 단계 | 내용 |
|---|---|
| 원지표 | 현금흐름(FCF/자산·영업CF/자산·발생액) · 성장(매출·순이익) · 수익성(ROE·ROA·GPM) · 안정성(F-Score·Altman Z·부채/자본) · 밸류(이익수익률·FCF수익률·B/P) · 모멘텀(12-1M·52주 고점비·6M 상대강도·EPS 30일 수정) |
| 표준화 | 시장 바스켓(미국 64 / 한국 44) 안에서 5~95% 윈저라이즈 후 Z. 팩터 = 지표 Z 평균을 다시 표준화 |
| 종합 | 현금흐름 25 · 성장 25 · 수익성 20 · 안정성 20 · 밸류 10 → 바스켓 내 재표준화 z → **점수 = clip(3 + z, 1, 5)** |
| 모멘텀 | 12-1M 35 · 52주 고점비 25 · 상대강도 15 · EPS 수정 25 → 같은 방식 |
| Tier | T1 종합≥3.0 & 모멘텀≥3.0 · T2 종합≥3.0 · T3 모멘텀≥3.5 · T4 나머지 |
| 함정 | 가치 함정(밸류 z≥0.5 & 12-1M<0 & EPS 하향) · 모멘텀 크러시(모멘텀≥3.5 & 3M 낙폭≤−30% 또는 FCF<0) · 테마 과열(모멘텀≥3.5 & F<4 또는 Altman<1.81) · 부실(Altman<1.81) · 저유동성(20일 거래대금 < $20M / ₩50억) · 200일선 이탈(T1·T3) |
| 울타리 | 종목 2~8% · 섹터 30~35% · 클러스터(반도체 체인 30 / 자동차·2차전지 25 / 방산·조선 25) · Tier별 상한(T1 8 · T2 5 · T3 4 · T4 2) |

## 원래 프롬프트 대비 변경점

| 항목 | 원 프롬프트 | 변경 | 이유 |
|---|---|---|---|
| 스택 | Next.js + FastAPI | **Vite React + Python 배치 JSON** (+ 선택적 FastAPI) | Beta Model 과 같은 구조 → GitHub Pages 정적 배포·Actions 자동 갱신 그대로 재사용. 서버 없이 휴대폰에서 조회 |
| Tier 임계값 | Composite ≥ 3.0 (Z) | **1~5 척도 (3 + z)** 로 해석 | Z 합계 ≥ 3 은 상위 0.1% 라 Tier 1 이 거의 비게 됨. 3.0 = 바스켓 평균, 3.5 ≈ 상위 30% |
| Z-Score 기준 | 단일 종목 검색 | **고정 유니버스 바스켓** + 바스켓 통계 저장 | Z 는 비교 대상이 있어야 계산 가능. 유니버스 밖 종목은 저장된 μ·σ 로 같은 기준 채점 |
| 한국 데이터 | PyKRX / KIS / DART | **yfinance (.KS/.KQ)** | 실측 결과 재무 3표·EPS 추정치·서프라이즈까지 제공 (44/44 종목 수집). 키 불필요. DART 는 .env.example 에 확장 자리만 |
| 밸류에이션 | DCF 또는 3년 평균 P/E | **바스켓 내 상대 밸류** (이익·FCF 수익률, B/P) | DCF 는 가정 의존이 크고, 과거 P/E 시계열은 무료 소스로 안정적으로 얻기 어려움 |
| 금융업 | — | Altman Z 미적용, 현금흐름·부채·GPM·ROA 지표 제외 | 예금·대출이 현금흐름/부채로 잡혀 업종 특성만 반영됨 |
| 저장소 | Zustand / SQLite | localStorage (탭·종목·포트폴리오) | 개인용 단일 사용자 — 서버 상태 불필요 |

## 한계

- yfinance 연간 재무는 최근 4년치 → F-Score 는 최근 2개 회계연도 비교. 분기 TTM 아님.
- 바스켓이 작아(64/44) 업종 중립 Z 대신 시장 전체 Z 를 쓴다 → 업종 특성(예: 고 GPM 소프트웨어)이 점수에 섞임.
- 백테스트·성과 검증("성과는 규칙으로 검증")은 아직 없음 — 과거 시점 재무를 무료로 재구성하기 어려움. 다음 단계 후보.
- 개인 투자 참고용이며 투자 권유가 아닙니다.
