import { useEffect, useRef, useState } from 'react'
import { Search, RefreshCw, Server, ServerOff, Play } from 'lucide-react'
import { TIER_COLOR, RUN_URL } from '../lib.js'
import { RegimeChip } from './ModelPortfolio.jsx'

function normalize(raw) {
  const t = raw.trim().toUpperCase()
  if (/^\d{6}$/.test(t)) return `${t}.KS`
  if (/\.(KS|KQ)$/.test(t)) return t
  return t.replace('.', '-')
}

export default function TopBar({ data, universe, market, setMarket, onSelect, apiOk, busy, onRefresh }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [remote, setRemote] = useState([])
  const [active, setActive] = useState(0)
  const boxRef = useRef(null)

  const query = q.trim().toLowerCase()
  const local = query
    ? universe
      .filter((r) => r.ticker.toLowerCase().includes(query) || r.name.toLowerCase().includes(query))
      .sort((a, b) => (a.market === market ? -1 : 0) - (b.market === market ? -1 : 0))
      .slice(0, 8)
    : []

  // 유니버스 밖 종목: 로컬 API 가 켜져 있을 때만 300ms 디바운스로 Yahoo 검색
  useEffect(() => {
    if (!apiOk || query.length < 2) { setRemote([]); return }
    const id = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        setRemote(r.ok ? await r.json() : [])
      } catch { setRemote([]) }
    }, 300)
    return () => clearTimeout(id)
  }, [query, apiOk])

  const known = new Set(local.map((r) => r.ticker))
  const items = [
    ...local.map((r) => ({ ticker: r.ticker, name: r.name, tier: r.tier, extra: r.extra })),
    ...remote.filter((r) => !known.has(r.ticker)).map((r) => ({ ticker: r.ticker, name: r.name, exchange: r.exchange })),
  ]

  useEffect(() => {
    const close = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const pick = (t) => { onSelect(t); setQ(''); setOpen(false); setActive(0) }

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && q.trim()) pick(items[active]?.ticker || normalize(q))
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <header className="sticky top-0 z-30 border-b border-gray-800 bg-[#0b0f19]/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="mr-2 flex items-center gap-2">
          <img src="./icon.svg" alt="" className="h-7 w-7" />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">주도주 퀀트 스코어</div>
            <div className="hidden text-[11px] text-gray-500 sm:block">Z-Score · F-Score · 4-Tier</div>
          </div>
        </div>

        <div ref={boxRef} className="relative order-3 w-full sm:order-none sm:w-auto sm:flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }}
            onFocus={() => setOpen(true)} onKeyDown={onKey}
            placeholder="종목 검색 — NVDA, MRVL, 삼성전자, 005930 …"
            aria-label="종목 검색"
            className="w-full rounded-lg border border-gray-800 bg-gray-900 py-2 pl-9 pr-3 text-base text-gray-100 sm:text-sm placeholder:text-gray-600 focus:border-gray-600 focus:outline-none"
          />
          {open && query && (
            <ul className="absolute left-0 right-0 top-full mt-1 max-h-80 overflow-auto rounded-lg border border-gray-800 bg-gray-950 py-1 shadow-xl" role="listbox">
              {items.map((it, i) => (
                <li key={it.ticker} role="option" aria-selected={i === active}>
                  <button onMouseDown={(e) => { e.preventDefault(); pick(it.ticker) }} onMouseEnter={() => setActive(i)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${i === active ? 'bg-gray-800' : ''}`}>
                    <span className="w-24 shrink-0 font-mono text-xs text-gray-400">{it.ticker}</span>
                    <span className="flex-1 truncate text-gray-200">{it.name}</span>
                    {it.tier ? (
                      <span className="rounded px-1.5 text-[11px] font-medium text-white" style={{ background: TIER_COLOR[it.tier] }}>T{it.tier}</span>
                    ) : <span className="text-[11px] text-gray-500">{it.exchange} · 실시간 채점</span>}
                    {it.extra && <span className="text-[10px] text-gray-500">추가</span>}
                  </button>
                </li>
              ))}
              {items.length === 0 && (
                <li className="px-3 py-2 text-sm text-gray-500">
                  유니버스에 없음 — Enter 로 {normalize(q)} {apiOk ? '실시간 채점' : '추가 채점 안내'}
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <div className="flex rounded-lg border border-gray-800 p-0.5" role="group" aria-label="시장">
            {['US', 'KR'].map((m) => (
              <button key={m} onClick={() => setMarket(m)} aria-pressed={market === m}
                className={`rounded-md px-3 py-1.5 text-xs font-medium ${market === m ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {m === 'US' ? '미국' : '한국'}
              </button>
            ))}
          </div>
          <button onClick={onRefresh} disabled={busy} title="데이터 새로 불러오기 (API 연결 시 현재 종목 재채점)"
            className="flex items-center gap-1.5 rounded-lg border border-gray-800 px-3 py-2 text-xs text-gray-300 hover:bg-gray-900 disabled:opacity-50">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> <span className="hidden sm:inline">갱신</span>
          </button>
          {!apiOk && (
            <a href={RUN_URL} target="_blank" rel="noreferrer" title="GitHub Actions 에서 재채점 / 종목 추가 (Run workflow)"
              className="flex items-center gap-1.5 rounded-lg border border-emerald-900 px-3 py-2 text-xs text-emerald-300 hover:bg-emerald-950">
              <Play size={14} /> <span className="hidden sm:inline">실행</span>
            </a>
          )}
          <span title={apiOk ? '로컬 분석 API 연결됨 — 임의 종목 실시간 채점 가능' : '정적 모드 — 유니버스 종목만 조회'}
            className={`hidden items-center gap-1 text-[11px] md:flex ${apiOk ? 'text-emerald-400' : 'text-gray-500'}`}>
            {apiOk ? <Server size={13} /> : <ServerOff size={13} />} {apiOk ? 'API' : '정적'}
          </span>
        </div>
      </div>
      {data && (
        <div className="mx-auto max-w-7xl px-4 pb-2 text-[11px] text-gray-500">
          <div className="flex flex-wrap gap-x-3">
            <RegimeChip mk={data.markets.US} label="🇺🇸" /><RegimeChip mk={data.markets.KR} label="🇰🇷" />
            <span className="hidden sm:inline">기준일 US {data.markets.US?.as_of ?? '–'} · KR {data.markets.KR?.as_of ?? '–'}</span>
          </div>
        </div>
      )}
    </header>
  )
}
