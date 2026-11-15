# 개발 환경 · 작업 방법

Claude Code 없이도, 다른 PC·다른 AI 도구(Codex, Cursor, Copilot, Gemini CLI 등)·사람이 이어서 작업할 수 있게 정리한 문서.
규칙은 [`AGENTS.md`](../AGENTS.md), 구조는 [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 1. 새 PC 준비

| 도구 | 버전 | 설치 |
|---|---|---|
| Git | 최신 | https://git-scm.com |
| uv | 0.13+ | Windows `winget install astral-sh.uv` · macOS `brew install uv` · 또는 `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| Python | 3.13 | uv 가 자동 설치 (`uv sync` 시) |
| Node.js | 24 (CI 와 동일) | https://nodejs.org 또는 `winget install OpenJS.NodeJS` |
| GitHub CLI (선택) | 최신 | `winget install GitHub.cli` → `gh auth login` |

```bash
git clone https://github.com/isk2026/zscore.git
cd zscore
uv sync                      # .venv 생성 + 의존성
cd dashboard && npm install && cd ..
cp .env.example .env         # 로컬에서 텔레그램 테스트할 때만 값 입력 (커밋 금지)
```

> Beta Model 로컬 폴백을 쓰려면 이 저장소 옆에 `Beta Model` 폴더가 있어야 한다(`../Beta Model/dashboard/public/data/beta_model.json`).
> 없어도 공개 URL 로 받으므로 필수는 아니다.

## 2. 매일 작업 흐름

```bash
git pull --rebase                         # 봇이 데이터를 매일 커밋하므로 항상 먼저
uv run python -m zscore.export            # 데이터 생성 (캐시 12시간)
cd dashboard && npm run dev               # http://localhost:5173 — 코드 수정 시 자동 반영
# (선택) 다른 터미널: uv run python -m uvicorn zscore.api:app --port 8000   → 검색창에서 유니버스 밖 종목 실시간 채점
```

커밋 전:
```bash
scripts/check.sh          # macOS/Linux/Git Bash
scripts\check.ps1         # Windows PowerShell
```
(= `uv run pytest -q` + `uv run ruff check zscore tests` + `npm run build`)

화면을 바꿨으면 브라우저 개발자 도구의 기기 모드로 **390px·360px** 폭을 꼭 확인한다.

## 3. 배포

`main` 에 푸시하면 끝. Actions `update-screener` 가 테스트 → 재채점 → 빌드 → Pages 배포를 한다.

```bash
git push
gh run watch -R isk2026/zscore $(gh run list -R isk2026/zscore -L 1 --json databaseId -q '.[0].databaseId')
```

- 데이터만 즉시 갱신: GitHub → Actions → update-screener → Run workflow (또는 `gh workflow run update.yml -R isk2026/zscore`)
- 종목 추가: Run workflow 의 `tickers` 입력 (예: `ASML, 000100`)

## 4. 비밀값 (GitHub Secrets)

| 이름 | 용도 | 비고 |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | 알림 봇 | **Beta Model 봇과 같은 값** (stockAlam 봇 아님) |
| `TELEGRAM_CHAT_ID` | 받을 채팅 | 〃 |

Beta Model 의 `.env` 에서 값을 화면에 출력하지 않고 옮기기 (Git Bash):
```bash
cd "../Beta Model" && for k in TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID; do grep "^$k=" .env | cut -d= -f2- | tr -d '"\r' | gh secret set $k -R isk2026/zscore; done
```
연결 확인: 로컬 `.env` 에 같은 값을 넣고 `uv run --env-file .env python -m zscore.notify --test`.

## 5. 자주 하는 변경 (레시피)

**임계값·가중치 조정** — `zscore/config.py` 만 고친다 → `export` → 화면 확인 → `test_*.py` 의 기대값 갱신

**원지표 추가**
1. `metrics.compute_raw` 에 값 (결측이면 `None`)
2. `config.FACTORS[팩터]` 에 `("지표", +1|-1)`, `config.METRIC_LABELS` 에 라벨
3. `dashboard/src/components/StockView.jsx` 의 `METRIC_LABEL`, `FACTOR_METRICS`
4. 효과 확인: `uv run python -m zscore.backtest` 의 IC·팩터 모니터

**유니버스 변경** — `config.UNIVERSE["US"|"KR"]`. 바스켓이 바뀌면 모든 Z 가 바뀌고 등급 이력에 대량 변화 알림이 나갈 수 있다 → 사용자에게 먼저 알린다

**새 화면 패널** — `components/` 에 파일 → 탭에 배치 → 설명은 `glossary.js` → 숫자는 `fmt.*`, 색은 `lib.js`

**표시 전용 → 점수 반영**(예: 수급) — `backtest.py` 에서 시점 재현이 가능한지 먼저 확인(과거 자료 필요). IC t ≥ 2 정도 근거 없이 점수에 넣지 않는다

**알림 항목 추가** — `tracking.alert_html` 또는 `market.update_state` 에서 문구 줄 추가. 첫 실행은 기준선(알림 없음)·같은 기준일 재실행 시 중복 없음을 테스트로 확인 (`tests/test_tracking.py`, `tests/test_market.py`)

## 6. 테스트

```
tests/test_scoring.py    F-Score, Altman, 12-1M, Tier, 바스켓 중심화, 함정, 티커 정규화, 백테스트 시점 슬라이스
tests/test_tracking.py   등급 변화·중복 방지, 실전 기록 NAV·리밸런싱, 모델 포트폴리오 예산·상한, 알림 이스케이프
tests/test_market.py     시장폭 구간·괴리, RRG 사분면, 시장 알림 상태, 스트레스 구간 수익
tests/test_explain.py    수급 합산·신호, 등급 이유 문장, 데이터 신뢰도 경고
```
모두 합성 데이터라 네트워크 없이 1~2초. 외부 API 를 부르는 테스트는 만들지 않는다.

## 7. 문제 해결

| 증상 | 원인 · 조치 |
|---|---|
| `uvicorn` 실행 시 "애플리케이션 제어 정책" 오류 (Windows) | `uv run python -m uvicorn ...` 로 실행 |
| `ModuleNotFoundError: zscore` | 저장소 루트에서 `uv run ...` 으로 실행 (`pyproject` 의 `pythonpath=["."]`) |
| 대시보드 "데이터를 불러오지 못했습니다" | `uv run python -m zscore.export` 를 먼저 실행 (`public/data/screener.json`) |
| 푸시 거부 (non-fast-forward) | 봇의 데이터 커밋 → `git pull --rebase` 후 푸시. 데이터 파일 충돌은 원격 것을 택한다 |
| 로컬에서 `data/tier_history.json` 등이 바뀜 | `--track` 을 돌린 것 → `git checkout -- data/` |
| 수급이 전부 비어 있음 | 네이버 API 변경 가능성 → `zscore/flows.py` 의 `FLOWS_URL`·필드명 확인 (`foreignerPureBuyQuant` 등) |
| Beta Model 미연결 표시 | `config.BETA_MODEL_URL` 접근 확인. 실패 시 기본 주식 비중 80% 로 동작 |
| 텔레그램 안 옴 | Secrets 확인 → Actions 로그 "Telegram alert" 단계 → `notify --test` |
| 한국 지수/종목 이상치 | yfinance 데이터 확인 (`uv run python -c "from zscore.data import fetch_benchmark; print(fetch_benchmark('KR').tail())"`) |

## 8. AI 도구별 설정 파일

| 도구 | 읽는 파일 |
|---|---|
| Codex CLI, Cursor, Aider, Jules 등 | `AGENTS.md` |
| Claude Code | `CLAUDE.md` → `@AGENTS.md` 가져옴 |
| Gemini CLI | `GEMINI.md` → `@AGENTS.md` 가져옴 |
| GitHub Copilot | `.github/copilot-instructions.md` → `AGENTS.md` 안내 |

규칙은 `AGENTS.md` 한 곳만 고친다. 도구별 파일에는 그 도구에만 해당하는 내용만 둔다.
