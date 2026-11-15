# 구조 · 데이터 흐름 · 데이터 계약

> 백엔드는 **배치**(Python이 JSON 파일을 만든다), 프론트는 **정적 사이트**(JSON을 읽기만 한다).
> 서버 없이 GitHub Actions + GitHub Pages 로만 돈다. 로컬 FastAPI 는 선택 사항.

## 1. 전체 흐름

```
                    ┌──────────── GitHub Actions: update-screener (평일 07:40·22:20 UTC, 수동, push) ────────────┐
yfinance ──┐        │                                                                                            │
네이버 수급 ┼─► data.py ─► metrics.py ─► scoring.py ─► export.py ──► dashboard/public/data/screener.json        │
Beta Model ┘   (캐시)     (원지표)       (Z·Tier·함정)  │  ├ flows.py    (수급, 표시 전용)                        │
 JSON                                                 │  ├ explain.py  (왜 이 등급 · 데이터 신뢰도)             │
                                                      │  ├ portfolio.py(Beta 국면 → 모델 포트폴리오)            │
                                                      │  ├ market.py   (시장폭 · 섹터 회전)                    │
                                                      │  ├ risk.py ──────────────► public/data/risk.json       │
                                                      │  └ tracking.py (--track) ─► data/*.json · live.json     │
                                                      │        └► data/alert_pending.html ─► notify.py ─► 텔레그램│
                     backtest.py ───────────────────────────────────────────────► public/data/backtest.json  │
                     → 데이터 커밋(예약·수동 실행만) → npm run build → Pages 배포                                │
                    └────────────────────────────────────────────────────────────────────────────────────────────┘
dashboard (React) ── fetch('./data/*.json') ──► 화면.  보유 비중·비교 목록은 localStorage (브라우저에만)
```

## 2. Python 모듈 (`zscore/`)

| 모듈 | 역할 | 입력 → 출력 |
|---|---|---|
| `config.py` | **모든 파라미터** (유니버스, 가중치, 임계값, 울타리, 국면 예산, 시장폭·위험·수급 기준, 경로) | — |
| `data.py` | yfinance 수집 + `data/cache/*.pkl` 12시간 캐시. `normalize_ticker`('005930'→'005930.KS'), `fetch_benchmark` | 티커 → `RawData` |
| `metrics.py` | 원지표: Piotroski F, Altman Z, 12-1M, 52주 고점비, 6M RS, EPS 수정, 밸류, `fy_end`·`fetched_at` | `RawData` → dict |
| `scoring.py` | 윈저라이즈 → Z → 팩터 → 종합/모멘텀(3+z) → Tier → 함정. `score_external` 은 저장된 바스켓 통계로 채점 | 레코드 → 채점 레코드 |
| `flows.py` | 한국 외국인·기관·개인 20일 순매수(네이버), 미국 공매도(yfinance) | 레코드 → `rec["flows"]` |
| `explain.py` | 한 줄 등급 이유 `why`, 데이터 신뢰도 `quality` | 채점 레코드 → `rec["why"]`, `rec["quality"]` |
| `portfolio.py` | Beta Model JSON 로드(URL → 로컬 → 기본 80%), 국면별 Tier 예산·상위 N·울타리 축소 | 종목 + 국면 → `model` |
| `market.py` | 바스켓 시장폭(200/50일선·고점 근접), 괴리, 섹터/클러스터 상대 회전(RRG), 시장 알림 상태 | 가격 → `market_view` |
| `risk.py` | 주간 수익률 2년(종목·지수·원/달러), 과거 하락 구간 수익 | 가격 → `risk.json` |
| `tracking.py` | 등급 스냅샷·변화, 실전 기록 NAV·리밸런싱, 알림 HTML | 채점 결과 → `data/*` |
| `notify.py` | `data/alert_pending.html` 텔레그램 전송 후 삭제. 실패해도 예외 없음 | — |
| `export.py` | 위 전부를 묶는 진입점 | → `screener.json`, `risk.json` |
| `backtest.py` | 월말 시점 재현(재무 90일 지연) 백테스트, Tier 성과, IC, 팩터별 IC·스프레드 | → `backtest.json` |
| `api.py` | (선택) FastAPI `/api/health`, `/api/analyze`, `/api/search` | — |

## 3. 프론트엔드 (`dashboard/src/`)

| 파일 | 내용 |
|---|---|
| `App.jsx` | 데이터 로드, 탭(분석·시장·스크리너·울타리·백테스트), URL 파라미터 `tab`·`market`·`ticker`·`cmp`, 비교 목록 상태 |
| `lib.js` | `TIER_COLOR`, `FLAG_META`, `fmt`(숫자 형식), `LS`(localStorage 래퍼 — try/catch) |
| `glossary.js` | ⓘ 설명 문구 (`<InfoTip k="키" />`) |
| `components/TopBar.jsx` | 검색, 시장 전환, 국면 칩, 데이터 지연 경고, 실행 버튼 |
| `StockView.jsx` + `StockExtras.jsx` | 종목 분석: Tier 배지, 왜 이 등급, 신뢰도, 점수 카드, 수급, 함정, 레이더, 차트, 팩터 표 |
| `Changes.jsx` | 최근 등급 변화, 등급 이력 막대 |
| `Market.jsx` | 시장폭 카드·차트, 섹터 주도력 지도, 섹터 표 |
| `Screener.jsx` + `Compare.jsx` | 4-Tier 매트릭스, 정렬 표, 종목 비교 |
| `PortfolioFencer.jsx` + `ModelPortfolio.jsx` + `RiskPanel.jsx` | 모델 포트폴리오, 울타리 점검, 포트폴리오 위험(계산은 `RiskPanel.analyze`) |
| `Backtest.jsx` + `LiveRecord.jsx` + `FactorMonitor.jsx` | 실전 기록, 백테스트, 팩터 성과 모니터 |

## 4. 데이터 계약

### `dashboard/public/data/screener.json`
```
generated_at                       ISO UTC
config
  tiers{1..4: name, en, action, max_weight}  factor_labels  composite_weights  momentum_weights
  thresholds{tier_composite, tier_momentum, tier3_momentum, altman_distress, altman_safe, fscore_strong}
  fence{stock_max, sector_max, clusters[{name, industries[], limit}]}  min_traded_value  benchmark
  market{zones, near_high, divergence, rrg}  stale_hours
markets.US | markets.KR
  as_of            최신 가격일
  stats            바스켓 지표 통계 (μ·σ·윈저 경계) — 유니버스 밖 종목 채점에 사용
  rows[]           스크리너용 경량 레코드 (ticker, name, sector, tier, 점수, flags[키], flow)
  stocks{ticker}   전체 레코드 (아래)
  extra{ticker}    추가 종목 (바스켓 통계 밖, 같은 기준 채점). 프론트가 stocks 에 합친다
  macro            Beta Model 국면 {available, regime, regime_name, equity_weight, ...}
  model            모델 포트폴리오 {equity_weight, regime, tier_budget, invested, cash, fence_cash, holdings[], excluded[]}
  market_view      {breadth{a200, a50, near_high, divergence, zone, series{d,a200,a50,near,index}}, sectors[], t1_counts[]}
  changes          {as_of, prev, items[{ticker, name, from, to, kind, flags?}]}   kind: enter_t1|exit_t1|up|down|flag
  timeline         {dates[], tiers{ticker: "1122-"}}
```
종목 레코드 주요 키: `ticker market name sector industry currency price change_pct as_of market_cap`
· 원지표(`fcf_to_assets` … `eps_revision`, `fscore`, `altman_z`) · `metric_z{}` `factor_z{}` `factor_scores{}`
· `composite_score momentum_score tier flags[{key,title,level,detail}] single_condition`
· `chart{d,c,ma200,m_start,m_end}` · `flows{kind,signal,tone,...}` · `why{line,rule,notes[]}` · `quality{available,total,missing[],fy_end,warn[]}`

### `backtest.json`
`generated_at`, `assumptions{...}`, `markets[m]{start, end, months, dates[], series{T1,T1_clean,T2,T3,T4,EW,INDEX: {label, returns[], equity[], stats}}, ic{composite, momentum, *_series}, factors{labels, ic{f:[]}, spread{f:[]}}, tier1_history[], names{}}`

### `risk.json`
`as_of, weeks[], ret{ticker: [주간 수익률|null]}, index{US,KR: []}, fx[] (USD/KRW), stress[{name,start,end,kind,index{US,KR},fx,ret{ticker}}], config{corr_cluster, weeks}`

### `live.json` (= `data/live_record.json` 사본)
`{US|KR: {start, nav[{date, model, t1, ew, index}], rebalances[{date, regime, equity_weight, cash, turnover, holdings{t:{w,p,tier}}}], state{...내부}}}`

## 5. 상태 파일 (`data/`, CI 가 커밋하는 정본)

| 파일 | 내용 | 갱신 |
|---|---|---|
| `extra_tickers.txt` | 추가 채점 종목 | `--add/--remove`, 수동 실행 입력 |
| `tier_history.json` | 시장별 기준일 → `{ticker: [tier, [위험키]]}`, `notified` | `--track` |
| `tier_changes.csv` | 등급 변화 누적 로그 | `--track` |
| `live_record.json` | 실전 기록 원본 | `--track` |
| `market_state.json` | 시장폭 구간·괴리·섹터 사분면 직전 상태 (알림 비교용) | `--track` |
| `cache/` | yfinance·수급 캐시 | git 제외 |
| `alert_pending.html` | 보낼 알림 (notify 가 보내고 지움) | git 제외 |

## 6. CI (`.github/workflows/update.yml`)

1. `uv sync --frozen` → `pytest`
2. `export --refresh` (+ 예약·수동이면 `--track`)
3. 텔레그램 (예약·수동만, Secrets `TELEGRAM_BOT_TOKEN`·`TELEGRAM_CHAT_ID`)
4. `backtest`
5. 데이터 커밋 (예약·수동만, `github-actions[bot]`)
6. `npm ci && npm run build` → Pages 배포

push 실행은 코드 배포용 — 데이터를 다시 만들지만 커밋하지 않고 이력도 갱신하지 않는다.

## 7. 외부 의존

| 대상 | 용도 | 실패 시 |
|---|---|---|
| yfinance | 가격·재무·EPS 추정치·공매도 | 종목 단위로 건너뜀 |
| `m.stock.naver.com/api/stock/{code}/trend` | 한국 수급 (비공식) | `flows: null` |
| `isk2026.github.io/beta-model/data/beta_model.json` | 시장 국면·주식 비중 | 로컬 `../Beta Model/...` → 기본 80% |
| Telegram Bot API | 알림 | 로그만 남기고 계속 |
| `KRW=X` (yfinance) | 원/달러 | 환율 효과 제외 |
