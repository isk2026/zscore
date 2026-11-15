# Zscore

퀀트 주도주 선별·위험 관리 대시보드 (성상현 매크로비욘드 12부). 구조·점수 체계는 README.md.

## 명령
- `uv run python -m zscore.export [--refresh] [--market US|KR]` — 채점 → `dashboard/public/data/screener.json`
- `uv run python -m uvicorn zscore.api:app --port 8000` — 로컬 API (`uvicorn.exe` 는 Windows 정책에 막힘 → 반드시 `python -m`)
- `uv run pytest -q` / `uv run ruff check zscore tests`
- `uv run python -m zscore.notify [--dry-run|--test]` — 텔레그램 알림 (Beta Model 봇, stockAlam 봇 사용 금지)
- `cd dashboard && npm run dev` (5173, /api → 8000 프록시) / `npm run build`

## 규칙
- 파라미터는 전부 `zscore/config.py` 한 곳. 대시보드는 `screener.json` 의 `config` 를 읽어 같은 값을 쓴다 (프론트에 임계값 하드코딩 금지 — 등급 색만 예외)
- 원지표 추가: `metrics.compute_raw` 에 값 → `config.FACTORS` 에 (이름, 방향) → `StockView.jsx` 의 `METRIC_LABEL`/`FACTOR_METRICS`
- 결측은 None 으로 두고 중립 처리. 0 으로 채우지 않는다
- 등급 색은 dataviz 팔레트 dark 단계(aqua·blue·orange) + 회색. Tier 는 위치·모양·라벨로도 구분되게 유지
- 비밀값은 `.env` (커밋 금지)
- `--track`(등급 이력·실전 기록)은 CI 예약/수동 실행 전용. 로컬에서 돌리면 이력이 갈라진다
