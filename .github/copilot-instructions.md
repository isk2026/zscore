# Copilot 지침

이 저장소의 작업 규칙은 루트의 `AGENTS.md` 에 있다 (모든 AI 도구 공통). 핵심만 요약:

- 파라미터는 전부 `zscore/config.py`. 프론트(`dashboard/`)는 `screener.json` 의 `config` 를 읽고 임계값을 하드코딩하지 않는다
- 결측은 `None` (0 으로 채우지 않음). 외부 소스 실패는 경고 후 계속
- 수급·시장폭·위험·요약은 표시 전용 — 점수에 넣지 않는다
- `export --track` 은 CI 전용. 비밀값은 `.env`/GitHub Secrets 에만
- UI 문구는 한국어, 휴대폰 360px 에서 가로 스크롤 없게
- 커밋 전 `uv run pytest -q`, `uv run ruff check zscore tests`, `cd dashboard && npm run build`
