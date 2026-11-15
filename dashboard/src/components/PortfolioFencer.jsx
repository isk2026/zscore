import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, ShieldCheck, ShieldAlert, RotateCcw } from 'lucide-react'
import { TIER_COLOR, FLAG_META, LS, fmt } from '../lib.js'

const DEFAULT = [
  { ticker: 'NVDA', w: 9 }, { ticker: 'AVGO', w: 7 }, { ticker: 'MU', w: 6 }, { ticker: '000660.KS', w: 8 },
  { ticker: '005930.KS', w: 8 }, { ticker: 'MSFT', w: 6 }, { ticker: 'GOOGL', w: 6 }, { ticker: 'LLY', w: 5 },
  { ticker: '005380.KS', w: 5 }, { ticker: 'JPM', w: 5 }, { ticker: '012450.KS', w: 5 }, { ticker: 'XOM', w: 4 },
]

const pct = (x) => `${(x * 100).toFixed(1)}%`

function Bar({ label, value, limit, color = '#3987e5', sub }) {
  const over = value > limit + 1e-9
  const scale = Math.max(limit * 1.6, value, 0.01)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-gray-300">{label} {sub && <span className="text-gray-500">{sub}</span>}</span>
        <span className={`num ${over ? 'font-semibold text-red-400' : 'text-gray-400'}`}>{pct(value)} / {pct(limit)}</span>
      </div>
      <div className="relative h-2.5 rounded-full bg-gray-800">
        <div className="absolute left-0 top-0 h-2.5 rounded-full" style={{ width: `${(value / scale) * 100}%`, background: over ? '#e66767' : color }} />
        <div className="absolute -top-1 h-4.5 w-0.5 bg-gray-300" style={{ left: `${(limit / scale) * 100}%` }} title={`상한 ${pct(limit)}`} />
      </div>
    </div>
  )
}

export default function PortfolioFencer({ data, universe, extra }) {
  const fence = data.config.fence
  const tiers = data.config.tiers
  const [items, setItems] = useState(() => LS.get('zs.portfolio', DEFAULT))
  const [stockMax, setStockMax] = useState(() => LS.get('zs.stockMax', fence.stock_max))
  const [sectorMax, setSectorMax] = useState(() => LS.get('zs.sectorMax', fence.sector_max))
  const [clusters, setClusters] = useState(() => LS.get('zs.clusters', fence.clusters))
  const [useTierCap, setUseTierCap] = useState(() => LS.get('zs.tierCap', true))
  const [newTicker, setNewTicker] = useState('')

  useEffect(() => LS.set('zs.portfolio', items), [items])
  useEffect(() => LS.set('zs.stockMax', stockMax), [stockMax])
  useEffect(() => LS.set('zs.sectorMax', sectorMax), [sectorMax])
  useEffect(() => LS.set('zs.clusters', clusters), [clusters])
  useEffect(() => LS.set('zs.tierCap', useTierCap), [useTierCap])

  const lookup = (t) => extra[t] || Object.values(data.markets).map((m) => m.stocks[t]).find(Boolean)

  const rows = useMemo(() => items.map((it) => {
    const s = lookup(it.ticker)
    const w = Math.max(0, Number(it.w) || 0) / 100
    const sector = it.sector || s?.sector || '미분류'
    const industry = s?.industry || ''
    const cl = clusters.filter((c) => c.industries.includes(industry)).map((c) => c.name)
    const tierCap = s ? tiers[s.tier].max_weight : stockMax
    const cap = useTierCap ? Math.min(stockMax, tierCap) : stockMax
    return { ...it, s, w, sector, industry, clusters: cl, cap }
  }), [items, data, extra, clusters, stockMax, useTierCap]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = rows.reduce((a, r) => a + r.w, 0)
  const bySector = {}
  rows.forEach((r) => { bySector[r.sector] = (bySector[r.sector] || 0) + r.w })
  const byCluster = clusters.map((c) => ({ ...c, w: rows.filter((r) => r.clusters.includes(c.name)).reduce((a, r) => a + r.w, 0) }))

  const violations = []
  if (total > 1.0001) violations.push(`총 비중 ${pct(total)} — 100% 초과 (레버리지 금지)`)
  rows.forEach((r) => {
    if (r.w > r.cap + 1e-9) {
      violations.push(`${r.s?.name || r.ticker}: ${pct(r.w)} > 상한 ${pct(r.cap)}${useTierCap && r.s && r.cap < stockMax ? ` (Tier ${r.s.tier} 상한)` : ''}`)
    }
    if (r.s?.flags?.some((f) => FLAG_META[f.key]?.level === 'danger')) {
      violations.push(`${r.s.name}: 심각 경고 — ${r.s.flags.filter((f) => f.level === 'danger').map((f) => f.title).join(', ')}`)
    }
  })
  Object.entries(bySector).forEach(([s, w]) => { if (w > sectorMax + 1e-9) violations.push(`섹터 ${s}: ${pct(w)} > ${pct(sectorMax)}`) })
  byCluster.forEach((c) => { if (c.w > c.limit + 1e-9) violations.push(`클러스터 ${c.name}: ${pct(c.w)} > ${pct(c.limit)}`) })

  // 규칙 적용 제안: 종목 상한 → 섹터 상한 → 클러스터 상한 순으로 비례 축소, 초과분은 현금
  const suggested = useMemo(() => {
    const s = rows.map((r) => ({ ticker: r.ticker, sector: r.sector, clusters: r.clusters, w: Math.min(r.w, r.cap) }))
    const shrink = (pred, limit) => {
      const g = s.filter(pred); const sum = g.reduce((a, x) => a + x.w, 0)
      if (sum > limit) g.forEach((x) => { x.w *= limit / sum })
    }
    for (let k = 0; k < 3; k++) {
      Object.keys(bySector).forEach((sec) => shrink((x) => x.sector === sec, sectorMax))
      clusters.forEach((c) => shrink((x) => x.clusters.includes(c.name), c.limit))
    }
    const t = s.reduce((a, x) => a + x.w, 0)
    if (t > 1) s.forEach((x) => { x.w /= t })
    return Object.fromEntries(s.map((x) => [x.ticker, x.w]))
  }, [rows, sectorMax, clusters]) // eslint-disable-line react-hooks/exhaustive-deps
  const sugTotal = Object.values(suggested).reduce((a, b) => a + b, 0)

  const update = (i, patch) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const add = () => {
    let t = newTicker.trim().toUpperCase()
    if (!t) return
    if (/^\d{6}$/.test(t)) t += '.KS'
    const hit = universe.find((u) => u.ticker === t || u.name.toUpperCase() === t)
    setItems((xs) => [...xs, { ticker: hit?.ticker || t, w: 2 }])
    setNewTicker('')
  }

  return (
    <div className="space-y-4">
      <section className={`flex items-start gap-3 rounded-xl border p-4 ${violations.length ? 'border-red-900/70 bg-red-950/25' : 'border-emerald-900/60 bg-emerald-950/20'}`}>
        {violations.length ? <ShieldAlert className="mt-0.5 shrink-0 text-red-400" /> : <ShieldCheck className="mt-0.5 shrink-0 text-emerald-400" />}
        <div className="text-sm">
          <div className="font-medium text-gray-100">{violations.length ? `울타리 위반 ${violations.length}건` : '모든 울타리 규칙 충족'}</div>
          {violations.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4 text-gray-300">{violations.map((v) => <li key={v}>{v}</li>)}</ul>}
          <div className="mt-1 text-xs text-gray-500">투자 {pct(Math.min(total, 1))} · 현금 {pct(Math.max(0, 1 - total))}</div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="panel min-w-0 p-4 lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-300">보유 종목</h2>
            <button onClick={() => setItems(DEFAULT)} className="-my-2 flex items-center gap-1 py-2 text-xs text-gray-500 hover:text-gray-300"><RotateCcw size={12} /> 예시로 초기화</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm sm:min-w-[560px]">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                  <th className="py-2 pr-2 font-normal">종목</th><th className="hidden py-2 pr-2 font-normal sm:table-cell">섹터</th>
                  <th className="py-2 pr-2 text-right font-normal">비중 %</th><th className="hidden py-2 pr-2 text-right font-normal sm:table-cell">상한</th>
                  <th className="py-2 pr-2 text-right font-normal">제안</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.ticker}-${i}`} className="border-b border-gray-800/50">
                    <td className="w-[55%] max-w-0 py-1.5 pr-2 sm:w-auto sm:max-w-none">
                      <div className="flex items-center gap-2">
                        {r.s ? <span className="rounded px-1 text-[10px] font-medium text-white" style={{ background: TIER_COLOR[r.s.tier] }}>T{r.s.tier}</span>
                          : <span className="rounded bg-gray-800 px-1 text-[10px] text-gray-500">?</span>}
                        <span className="truncate text-gray-100">{r.s?.name || r.ticker}</span>
                      </div>
                      <div className="truncate font-mono text-[10px] text-gray-500">{r.ticker}<span className="sm:hidden"> · {r.sector}</span>{r.clusters.length ? ` · ${r.clusters.join(', ')}` : ''}</div>
                      {!r.s && (
                        <input value={r.sector === '미분류' ? '' : r.sector} placeholder="섹터 입력" onChange={(e) => update(i, { sector: e.target.value })}
                          className="mt-1 w-28 rounded border border-gray-800 bg-gray-900 px-1.5 py-1 text-base sm:hidden" />
                      )}
                    </td>
                    <td className="hidden py-1.5 pr-2 sm:table-cell">
                      {r.s ? <span className="text-xs text-gray-400">{r.sector}</span> : (
                        <input value={r.sector === '미분류' ? '' : r.sector} placeholder="섹터 입력" onChange={(e) => update(i, { sector: e.target.value })}
                          className="w-28 rounded border border-gray-800 bg-gray-900 px-1.5 py-0.5 text-xs" />
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={items[i].w} onChange={(e) => update(i, { w: e.target.value })}
                        aria-label={`${r.ticker} 비중`}
                        className={`num w-14 rounded border bg-gray-900 sm:w-16 px-1.5 py-1 text-right text-base sm:py-0.5 sm:text-sm ${r.w > r.cap + 1e-9 ? 'border-red-700 text-red-300' : 'border-gray-800'}`} />
                    </td>
                    <td className="num hidden py-1.5 pr-2 text-right text-xs text-gray-500 sm:table-cell">{pct(r.cap)}</td>
                    <td className={`num py-1.5 pr-2 text-right text-xs ${suggested[r.ticker] < r.w - 1e-6 ? 'text-amber-300' : 'text-gray-400'}`}>{pct(suggested[r.ticker] ?? 0)}</td>
                    <td className="py-1.5 text-right">
                      <button aria-label="삭제" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="-m-2 p-2.5 text-gray-600 hover:text-red-400"><Trash2 size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2">
            <input value={newTicker} onChange={(e) => setNewTicker(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()}
              list="zs-universe" placeholder="티커 추가 (예: MRVL, 005930)"
              className="min-w-0 flex-1 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-base sm:py-1.5 sm:text-sm" />
            <datalist id="zs-universe">{universe.map((u) => <option key={u.ticker} value={u.ticker}>{u.name}</option>)}</datalist>
            <button onClick={add} className="flex items-center gap-1 rounded-lg bg-gray-800 px-3 text-sm text-gray-200 hover:bg-gray-700"><Plus size={14} /> 추가</button>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-gray-600">
            제안 비중 = 종목 상한 → 섹터 상한 → 클러스터 상한 순으로 비례 축소, 초과분은 현금(제안 합계 {pct(sugTotal)}).
            Tier별 상한: {Object.entries(tiers).map(([t, v]) => `T${t} ${pct(v.max_weight)}`).join(' · ')}
          </p>
        </section>

        <section className="panel min-w-0 space-y-5 p-4 lg:col-span-2">
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-gray-300">울타리 설정</h2>
            <label className="block text-xs text-gray-400">
              종목당 상한 <span className="num text-gray-200">{pct(stockMax)}</span>
              <input type="range" min={fence.stock_max_range[0]} max={fence.stock_max_range[1]} step="0.005" value={stockMax}
                onChange={(e) => setStockMax(Number(e.target.value))} className="mt-1 h-7 w-full" />
            </label>
            <label className="block text-xs text-gray-400">
              섹터당 상한 <span className="num text-gray-200">{pct(sectorMax)}</span>
              <input type="range" min={fence.sector_max_range[0]} max={fence.sector_max_range[1]} step="0.005" value={sectorMax}
                onChange={(e) => setSectorMax(Number(e.target.value))} className="mt-1 h-7 w-full" />
            </label>
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" className="h-4 w-4" checked={useTierCap} onChange={(e) => setUseTierCap(e.target.checked)} /> Tier별 상한 적용 (T1 8% · T2 5% · T3 4% · T4 2%)
            </label>
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-medium text-gray-400">섹터 비중</h3>
            {Object.entries(bySector).sort((a, b) => b[1] - a[1]).map(([s, w]) => <Bar key={s} label={s} value={w} limit={sectorMax} />)}
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-medium text-gray-400">위험 클러스터 (동일 위험 공유)</h3>
            {byCluster.map((c, i) => (
              <div key={c.name} className="space-y-1">
                <Bar label={c.name} value={c.w} limit={c.limit} color="#199e70" />
                <div className="flex items-center gap-2 text-[11px] text-gray-500">
                  상한
                  <input type="number" min="5" max="60" step="1" value={Math.round(c.limit * 100)}
                    onChange={(e) => setClusters((cs) => cs.map((x, j) => (j === i ? { ...x, limit: Number(e.target.value) / 100 } : x)))}
                    className="num w-14 rounded border border-gray-800 bg-gray-900 px-1 py-0.5 text-right text-base sm:text-[11px]" />%
                  <span className="truncate" title={c.industries.join(', ')}>· {c.industries.length}개 업종</span>
                </div>
              </div>
            ))}
            <button onClick={() => setClusters(fence.clusters)} className="text-[11px] text-gray-500 hover:text-gray-300">클러스터 기본값 복원</button>
          </div>
        </section>
      </div>
      <p className="text-[11px] text-gray-600">보유 비중은 이 브라우저에만 저장됩니다. 투자 {fmt.pctPlain(total)} 기준.</p>
    </div>
  )
}
