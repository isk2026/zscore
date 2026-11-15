import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, LayoutGrid, Shield, AlertCircle } from 'lucide-react'
import TopBar from './components/TopBar.jsx'
import StockView from './components/StockView.jsx'
import Screener from './components/Screener.jsx'
import PortfolioFencer from './components/PortfolioFencer.jsx'
import { LS } from './lib.js'

const TABS = [
  { id: 'stock', label: '종목 분석', icon: Activity },
  { id: 'screener', label: '스크리너', icon: LayoutGrid },
  { id: 'fence', label: '포트폴리오 울타리', icon: Shield },
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

  const loadData = useCallback(async () => {
    try {
      const r = await fetch(`./data/screener.json?t=${Date.now()}`)
      if (!r.ok) throw new Error(`screener.json ${r.status}`)
      setData(await r.json())
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

  const universe = useMemo(() => {
    if (!data) return []
    return Object.values(data.markets).flatMap((m) => m.rows)
  }, [data])

  const analyze = useCallback(async (t, { refresh = false } = {}) => {
    setTicker(t)
    setTab('stock')
    const mkt = /\.(KS|KQ)$/.test(t) ? 'KR' : 'US'
    setMarket(mkt)
    const inUniverse = data?.markets?.[mkt]?.stocks?.[t]
    if (inUniverse && !refresh) return
    if (!apiOk) {
      if (!inUniverse) setError(`${t} 는 유니버스에 없습니다. 임의 종목 분석은 로컬 API(uvicorn zscore.api:app) 실행 시 가능합니다.`)
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
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                tab === id ? 'bg-gray-800 text-white' : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'}`}>
              <Icon size={16} /> {label}
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
        ) : tab === 'stock' ? (
          stock ? <StockView stock={stock} data={data} busy={busy} />
            : <div className="py-24 text-center text-gray-500">위 검색창에서 종목을 선택하세요.</div>
        ) : tab === 'screener' ? (
          <Screener data={data} market={market} setMarket={setMarket} onSelect={analyze} />
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
