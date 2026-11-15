import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, LayoutGrid, Shield, AlertCircle, Play, ExternalLink, LineChart, Globe } from 'lucide-react'
import TopBar from './components/TopBar.jsx'
import StockView from './components/StockView.jsx'
import Screener from './components/Screener.jsx'
import PortfolioFencer from './components/PortfolioFencer.jsx'
import Backtest from './components/Backtest.jsx'
import Market from './components/Market.jsx'
import { LS, RUN_URL } from './lib.js'

const TABS = [
  { id: 'stock', label: '종목 분석', short: '분석', icon: Activity },
  { id: 'market', label: '시장', icon: Globe },
  { id: 'screener', label: '스크리너', icon: LayoutGrid },
  { id: 'fence', label: '포트폴리오 울타리', short: '울타리', icon: Shield },
  { id: 'backtest', label: '백테스트', icon: LineChart },
]

export default function App() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [apiOk, setApiOk] = useState(false)
  const qs = new URLSearchParams(window.location.search)
  const [tab, setTab] = useState(() => qs.get('tab') || LS.get('zs.tab', 'stock'))
  const [market, setMarket] = useState(() => qs.get('market') || LS.get('zs.market', 'US'))
  const [ticker, setTicker] = useState(() => qs.get('ticker') || LS.get('zs.ticker', 'NVDA'))
  const [extra, setExtra] = useState({}) // API로 채점한 유니버스 밖 종목
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(null) // 정적 모드에서 찾지 못한 종목
  const [compare, setCompare] = useState(() => (qs.get('cmp') ? qs.get('cmp').split(',') : LS.get('zs.compare', [])))
  const toggleCompare = useCallback((t) => setCompare((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : xs.length >= 4 ? xs : [...xs, t])), [])

  const loadData = useCallback(async () => {
    try {
      const r = await fetch(`./data/screener.json?t=${Date.now()}`)
      if (!r.ok) throw new Error(`screener.json ${r.status}`)
      const j = await r.json()
      // 추가 종목(extra)은 바스켓 통계 밖 — 조회용으로 stocks 에 합친다 (스크리너 rows 에는 넣지 않음)
      Object.values(j.markets).forEach((m) => { m.stocks = { ...(m.extra || {}), ...m.stocks } })
      setData(j)
      setError(null)
    } catch (e) {
      setError(`데이터를 불러오지 못했습니다 (${e.message}). 먼저 python -m zscore.export 를 실행하세요.`)
    }
  }, [])

  useEffect(() => {
    loadData()
    fetch('/api/health').then((r) => r.ok && r.json()).then((j) => setApiOk(!!j?.ok)).catch(() => setApiOk(false))
  }, [loadData])

  useEffect(() => LS.set('zs.tab', tab), [tab])
  useEffect(() => LS.set('zs.market', market), [market])
  useEffect(() => LS.set('zs.ticker', ticker), [ticker])
  useEffect(() => LS.set('zs.compare', compare), [compare])

  const universe = useMemo(() => {
    if (!data) return []
    return Object.values(data.markets).flatMap((m) => [
      ...m.rows,
      ...Object.values(m.extra || {}).map((x) => ({ ticker: x.ticker, name: x.name, tier: x.tier, sector: x.sector, extra: true })),
    ])
  }, [data])

  const analyze = useCallback(async (t, { refresh = false } = {}) => {
    setTicker(t)
    setTab('stock')
    setMissing(null)
    const mkt = /\.(KS|KQ)$/.test(t) ? 'KR' : 'US'
    setMarket(mkt)
    const inUniverse = data?.markets?.[mkt]?.stocks?.[t]
    if (inUniverse && !refresh) return
    if (!apiOk) {
      if (!inUniverse) setMissing(t)
      return
    }
    setBusy(true)
    try {
      const r = await fetch(`/api/analyze?ticker=${encodeURIComponent(t)}${refresh ? '&refresh=true' : ''}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.detail || r.status)
      setExtra((x) => ({ ...x, [j.stock.ticker]: { ...j.stock, _live: true, _inUniverse: j.in_universe } }))
      setTicker(j.stock.ticker)
      setError(null)
    } catch (e) {
      setError(`${t} 분석 실패: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }, [data, apiOk])

  const stock = extra[ticker] || data?.markets?.[market]?.stocks?.[ticker]
    || Object.values(data?.markets || {}).map((m) => m.stocks[ticker]).find(Boolean)

  return (
    <div className="min-h-screen overflow-x-clip">
      <TopBar
        data={data} universe={universe} market={market} setMarket={setMarket}
        onSelect={(t) => analyze(t)} apiOk={apiOk} busy={busy}
        onRefresh={async () => { await loadData(); if (ticker) analyze(ticker, { refresh: apiOk }) }}
      />
      <main className="mx-auto max-w-7xl px-4 pb-16">
        <nav className="flex gap-1 overflow-x-auto py-3" role="tablist">
          {TABS.map(({ id, label, short, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm transition sm:gap-2 sm:px-3 ${
                tab === id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'}`}>
              <Icon size={16} className="max-sm:hidden" /> <span className="sm:hidden">{short || label}</span><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-orange-900/60 bg-orange-950/30 p-3 text-sm text-orange-200">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span className="flex-1">{error}</span>
            <button className="text-orange-300/70 hover:text-orange-200" onClick={() => setError(null)}>닫기</button>
          </div>
        )}
        {!data ? (
          !error && <div className="py-24 text-center text-gray-500">불러오는 중…</div>
        ) : tab === 'stock' && !stock && (missing || ticker) && !busy ? (
          <section className="panel mx-auto max-w-xl space-y-3 p-5 text-sm text-gray-300">
            <div className="text-base font-medium text-white">{missing || ticker} 는 아직 채점되지 않았습니다</div>
            <p>{apiOk ? '로컬 API 로 다시 검색하거나, ' : ''}GitHub Actions 로 추가 채점합니다 (약 3~5분). 추가된 종목은 이후 매일 자동 갱신됩니다.</p>
            <ol className="list-decimal space-y-1 pl-5 text-gray-400">
              <li>아래 버튼 → <b className="text-gray-200">Run workflow</b> 펼치기</li>
              <li><b className="text-gray-200">tickers</b> 칸에 <code className="rounded bg-gray-800 px-1 text-gray-100">{missing || ticker}</code> 입력 → 초록 Run workflow</li>
              <li>완료 후 이 페이지 상단 <b className="text-gray-200">갱신</b></li>
            </ol>
            <a href={RUN_URL} target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-600">
              <Play size={16} /> GitHub 에서 실행 <ExternalLink size={14} />
            </a>
          </section>
        ) : tab === 'stock' ? (
          stock ? <StockView stock={stock} data={data} busy={busy} compare={compare} toggleCompare={toggleCompare} />
            : <div className="py-24 text-center text-gray-500">위 검색창에서 종목을 선택하세요.</div>
        ) : tab === 'screener' ? (
          <Screener data={data} market={market} setMarket={setMarket} onSelect={analyze} compare={compare} setCompare={setCompare} toggleCompare={toggleCompare} />
        ) : tab === 'market' ? (
          <Market data={data} market={market} setMarket={setMarket} onSelect={analyze} />
        ) : tab === 'backtest' ? (
          <Backtest market={market} setMarket={setMarket} data={data} />
        ) : (
          <PortfolioFencer data={data} universe={universe} extra={extra} />
        )}
      </main>
      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs leading-relaxed text-gray-600">
        성상현 매크로비욘드 12부 「주도주는 규칙으로 고르고, 위험은 규칙으로 담으며, 성과는 규칙으로 검증한다」 프레임워크 구현.
        데이터: Yahoo Finance(yfinance) · 생성 {data?.generated_at?.replace('T', ' ').slice(0, 16)} UTC · 개인 투자 참고용이며 투자 권유가 아닙니다.
      </footer>
    </div>
  )
}
