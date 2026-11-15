# AGENTS.md — Zscore 작업 지침 (모든 AI 코딩 도구·사람 공통)

이 파일이 **단일 기준**이다. Claude Code(`CLAUDE.md`), Gemini CLI(`GEMINI.md`), GitHub Copilot(`.github/copilot-instructions.md`)
설정 파일은 모두 이 파일을 가리킨다. Codex·Cursor·Aider 등은 이 파일을 직접 읽는다. 규칙을 바꿀 땐 여기만 고친다.

- 무엇: 퀀트 주도주 선별·위험 관리 대시보드 (성상현 매크로비욘드 12부, 원문 `Reference.txt`)
- 사용자용 설명: [`docs/MANUAL.md`](docs/MANUAL.md) · 구조·데이터 계약: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · 환경·작업 방법: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md)
- 배포: https://isk2026.github.io/zscore/ (GitHub Pages, 저장소 `isk2026/zscore`)
- 사용자는 한국어 사용. UI 문구·커밋 본문 설명·문서는 한국어

## 빠른 시작

```bash
uv sync                                   # Python 3.13 + 의존성 (uv 필요)
uv run python -m zscore.export            # 채점 → dashboard/public/data/{screener,risk}.json (첫 실행 ~1분, 12시간 캐시)
uv run python -m zscore.backtest          # → dashboard/public/data/backtest.json
cd dashboard && npm install && npm run dev  # http://localhost:5173
```

## 명령

| 명령 | 용도 |
|---|---|
| `uv run python -m zscore.export [--refresh] [--market US\|KR] [--add T1,T2] [--remove T]` | 수집·채점·모델 포트폴리오·시장폭·위험 데이터 |
| `uv run python -m zscore.export --track` | **CI 전용**. 등급 이력·실전 기록·시장 상태 갱신 + 알림 문구 생성 |
| `uv run python -m zscore.backtest` | 시점 재현 월간 백테스트 + 팩터 모니터 |
| `uv run python -m zscore.notify [--dry-run\|--test]` | 텔레그램 전송 (Beta Model 봇) |
| `uv run python -m uvicorn zscore.api:app --port 8000` | (선택) 로컬 API — 유니버스 밖 종목 실시간 채점 |
| `uv run pytest -q` · `uv run ruff check zscore tests` | 테스트 · 린트 (커밋 전 필수) |
| `cd dashboard && npm run build` | 프론트 빌드 확인 (커밋 전 필수) |
| `scripts/check.sh` 또는 `scripts\check.ps1` | 위 세 가지를 한 번에 |

## 반드시 지킬 규칙

1. **파라미터는 전부 `zscore/config.py`**. 프론트는 `screener.json` 의 `config` 를 읽는다 — 프론트에 임계값 하드코딩 금지 (등급 색만 예외)
2. **결측은 `None`** 으로 두고 중립 처리. 0 으로 채우지 않는다
3. **`--track` 은 로컬에서 실행 금지**. 이력 파일(`data/tier_history.json` 등)은 CI 가 커밋하는 것이 정본 — 로컬에서 돌리면 이력이 갈라진다.
   로컬에서 실수로 바뀌었으면 `git checkout -- data/` 로 되돌린다
4. **표시 전용 지표를 점수에 넣지 않는다**: 수급(`flows.py`), 시장폭·섹터(`market.py`), 위험(`risk.py`), 요약(`explain.py`).
   점수에 넣으려면 먼저 `backtest.py` 에 넣어 IC 로 효과를 확인하고 사용자와 상의
5. **텔레그램은 Beta Model 봇만** (`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID`). stockAlam 봇은 사용하지 않는다
6. **비밀값은 `.env`(커밋 금지)와 GitHub Secrets**. 코드·로그·문서에 값을 쓰지 않는다. `notify.py` 는 토큰을 로그에서 가린다
7. 외부 소스 실패가 전체를 멈추면 안 된다: 종목 하나·수급·Beta Model·위험 데이터 실패는 경고 로그 후 계속 (`try/except` + `noqa: BLE001` 사유 주석)
8. 등급 색: T1 `#199e70` · T2 `#3987e5` · T3 `#d95926` · T4 `#6b7280`. Tier 는 색만이 아니라 모양·라벨로도 구분되게 유지
9. 휴대폰(360~390px)에서 가로 스크롤이 생기면 안 된다. 넓은 표는 `overflow-x-auto` + 첫 열 `sticky`
10. 투자 권유 표현 금지 — "매수 추천"·목표주가 대신 "규칙상 신호"

## 자주 하는 변경

- **원지표 추가**: `metrics.compute_raw` 에 값 → `config.FACTORS` 에 `(이름, 방향)` → `config.METRIC_LABELS` →
  `dashboard/src/components/StockView.jsx` 의 `METRIC_LABEL`/`FACTOR_METRICS` → 테스트
- **유니버스 종목 변경**: `config.UNIVERSE` (한국은 이름 지정). 일회성 추가는 `--add` (→ `data/extra_tickers.txt`)
- **설명 툴팁**: `dashboard/src/glossary.js` 에 항목 → `<InfoTip k="키" />`
- **새 데이터 파일을 CI 가 커밋하게**: `.github/workflows/update.yml` 의 *Commit data* 단계에 경로 추가
- **새 탭/패널**: `App.jsx` 의 `TABS` + 분기. 짧은 라벨(`short`)과 360px 확인

## 완료 전 확인

1. `uv run pytest -q` 통과 · `uv run ruff check zscore tests` 통과 · `npm run build` 통과
2. 화면을 바꿨으면 PC(1300px)와 휴대폰(390px, 360px)에서 실제로 열어 보고 콘솔 오류·가로 스크롤 없음 확인
3. `git status` 에 `data/` 이력 파일이나 `.env` 가 섞여 있지 않은지 확인
4. 커밋 → `main` 푸시 → Actions(`update-screener`) 성공 → Pages 반영 확인 (`gh run watch`)

## 함정

- Windows 애플리케이션 제어가 `uvicorn.exe` 를 막는다 → 반드시 `python -m uvicorn`
- `uv run` 은 Python 3.13 가상환경(`.venv`)을 쓴다. 시스템 파이썬으로 실행하면 의존성이 없다
- 네이버 수급 API(`m.stock.naver.com/api/stock/{code}/trend`)는 비공식 — 바뀌면 수급만 비고 나머지는 동작해야 한다
- GitHub 예약 실행은 수십 분~수 시간 늦을 수 있다. 데이터 커밋 봇(`github-actions[bot]`)과 충돌하므로 푸시 전 `git pull --rebase`
- Git Bash heredoc 안의 파이썬 문자열에 `\n` 을 넣으면 실제 줄바꿈으로 바뀌는 경우가 있었다 — 파일 수정은 에디터/패치 도구로
- `screener.json` 은 ~1.3MB. 종목별 차트·이력 같은 큰 배열을 늘릴 땐 크기를 확인
