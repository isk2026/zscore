import { useMemo, useState } from 'react'
import { Scatter } from 'react-chartjs-2'
import { ArrowDownUp } from 'lucide-react'
import { TIER_COLOR, TIER_SHAPE, FLAG_META, fmt, scoreTone } from '../lib.js'
import InfoTip from './InfoTip.jsx'

const quadrantPlugin = {
  id: 'quadrants',
  beforeDatasetsDraw(chart, _a, o) {
    const { ctx, chartArea: a, scales: { x, y } } = chart
    const cx = x.getPixelForValue(o.comp), cy = y.getPixelForValue(o.mom), cy3 = y.getPixelForValue(o.mom3)
    ctx.save()
    const fill = (x0, y0, x1, y1, c) => { ctx.fillStyle = c; ctx.fillRect(x0, y0, x1 - x0, y1 - y0) }
    fill(cx, a.top, a.right, cy, `${TIER_COLOR[1]}14`)
    fill(cx, cy, a.right, a.bottom, `${TIER_COLOR[2]}10`)
    fill(a.left, a.top, cx, cy3, `${TIER_COLOR[3]}12`)
    ctx.strokeStyle = '#374151'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx, a.top); ctx.lineTo(cx, a.bottom); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(a.right, cy); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(a.left, cy3); ctx.lineTo(cx, cy3); ctx.stroke()
    ctx.setLineDash([]); ctx.font = '600 11px Inter, sans-serif'
    const lab = (t, xx, yy, align) => { ctx.fillStyle = '#9ca3af'; ctx.textAlign = align; ctx.fillText(t, xx, yy) }
    lab('Tier 1 핵심 주도주', a.right - 6, a.top + 14, 'right')
    lab('Tier 2 펀더멘털 주도주', a.right - 6, a.bottom - 8, 'right')
    lab('Tier 3 모멘텀 주도주', a.left + 6, a.top + 14, 'left')
    lab('Tier 4 관찰 대상', a.left + 6, a.bottom - 8, 'left')
    ctx.restore()
  },
}

function Matrix({ rows, cfg, onSelect }) {
  const th = cfg.thresholds
  const data = {
    datasets: [1, 2, 3, 4].map((t) => ({
      label: `T${t} ${cfg.tiers[t].name}`,
      data: rows.filter((r) => r.tier === t && r.composite_score != null && r.momentum_score != null)
        .map((r) => ({ x: r.composite_score, y: r.momentum_score, r })),
      // star 는 선으로만 그려지므로 테두리를 등급 색으로
      backgroundColor: TIER_COLOR[t], borderColor: t === 1 ? TIER_COLOR[t] : '#111827', borderWidth: t === 1 ? 2.5 : 2,
      pointStyle: TIER_SHAPE[t], pointRadius: 7, pointHoverRadius: 10, pointHitRadius: 10,
    })),
  }
  const options = {
    maintainAspectRatio: false,
    scales: {
      x: { min: 1, max: 5, title: { display: true, text: '종합 점수 (펀더멘털) →', color: '#9ca3af' }, grid: { color: '#1f293766' } },
      y: { min: 1, max: 5, title: { display: true, text: '모멘텀 점수 →', color: '#9ca3af' }, grid: { color: '#1f293766' } },
    },
    onClick: (_e, els, chart) => {
      if (!els.length) return
      const p = chart.data.datasets[els[0].datasetIndex].data[els[0].index]
      onSelect(p.r.ticker)
    },
    onHover: (e, els) => { e.native.target.style.cursor = els.length ? 'pointer' : 'default' },
    plugins: {
      quadrants: { comp: th.tier_composite, mom: th.tier_momentum, mom3: th.tier3_momentum },
      legend: { position: 'bottom', labels: { usePointStyle: true, color: '#9ca3af' } },
      tooltip: {
        callbacks: {
          title: (items) => `${items[0].raw.r.name} (${items[0].raw.r.ticker})`,
          label: (c) => `종합 ${fmt.n(c.raw.x)} · 모멘텀 ${fmt.n(c.raw.y)} · F ${c.raw.r.fscore ?? '–'}`,
        },
      },
    },
  }
  return <div className="h-[28rem]"><Scatter data={data} options={options} plugins={[quadrantPlugin]} /></div>
}

const COLS = [
  ['name', '종목'], ['tier', 'Tier', 'tier'], ['composite_score', '종합', 'composite'], ['momentum_score', '모멘텀', 'momentum'],
  ['fscore', 'F', 'fscore'], ['altman_z', 'Altman', 'altman'], ['ret_12_1', '12-1M', 'ret_12_1'], ['high52_ratio', '고점비', 'high52'],
  ['eps_revision', 'EPS 수정', 'eps_revision'], ['pe', 'PER', 'pe'],
]

export default function Screener({ data, market, setMarket, onSelect }) {
  const cfg = data.config
  const rows = data.markets[market]?.rows || []
  const [tierFilter, setTierFilter] = useState(new Set([1, 2, 3, 4]))
  const [hideFlags, setHideFlags] = useState(false)
  const [sort, setSort] = useState({ key: 'composite_score', dir: -1 })

  const filtered = useMemo(() => {
    const r = rows.filter((x) => tierFilter.has(x.tier) && (!hideFlags || !x.flags.some((f) => FLAG_META[f]?.level === 'danger')))
    const k = sort.key
    return [...r].sort((a, b) => {
      const av = a[k], bv = b[k]
      if (av == null) return 1
      if (bv == null) return -1
      return (typeof av === 'string' ? av.localeCompare(bv) : av - bv) * sort.dir
    })
  }, [rows, tierFilter, hideFlags, sort])

  const counts = [1, 2, 3, 4].map((t) => rows.filter((r) => r.tier === t).length)
  const toggle = (t) => setTierFilter((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n.size ? n : s })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[1, 2, 3, 4].map((t, i) => (
          <button key={t} onClick={() => toggle(t)} aria-pressed={tierFilter.has(t)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition ${tierFilter.has(t) ? 'border-gray-600 text-gray-100' : 'border-gray-800 text-gray-500 opacity-60'}`}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TIER_COLOR[t] }} />
            T{t} {cfg.tiers[t].name} <span className="num text-gray-400">{counts[i]}</span>
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 py-1 text-xs text-gray-400">
          <input type="checkbox" className="h-4 w-4" checked={hideFlags} onChange={(e) => setHideFlags(e.target.checked)} />
          심각 경고 종목 숨기기
        </label>
        <div className="flex rounded-lg border border-gray-800 p-0.5">
          {['US', 'KR'].map((m) => (
            <button key={m} onClick={() => setMarket(m)} className={`rounded-md px-3 py-1 text-xs ${market === m ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>{m}</button>
          ))}
        </div>
      </div>

      <section className="panel p-4">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-gray-300">4-Tier 매트릭스 — {market} 바스켓 {rows.length}종목 <InfoTip k="tier" /></h2>
          <span className="hidden text-[11px] text-gray-500 sm:inline">점을 누르면 종목 분석으로 이동</span>
        </div>
        <Matrix rows={filtered} cfg={cfg} onSelect={onSelect} />
      </section>

      <section className="panel p-4">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              {COLS.map(([k, l, tip]) => (
                <th key={k} className={`py-2 pr-3 font-normal ${k === 'name' ? 'sticky left-0 z-10 bg-[#111827]' : 'text-right'}`}>
                  <button className="-my-1 inline-flex items-center gap-1 py-1.5 hover:text-gray-300"
                    onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : -1 }))}>
                    {l} {sort.key === k && <ArrowDownUp size={11} />}
                  </button>
                  {tip && <InfoTip k={tip} size={11} />}
                </th>
              ))}
              <th className="py-2 font-normal">경고</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.ticker} onClick={() => onSelect(r.ticker)} className="cursor-pointer border-b border-gray-800/50 hover:bg-gray-900">
                <td className="sticky left-0 z-10 max-w-[9rem] bg-[#111827] py-2 pr-3 sm:max-w-none">
                  <div className="truncate text-gray-100">{r.name}</div>
                  <div className="truncate font-mono text-[11px] text-gray-500">{r.ticker} · {r.sector}</div>
                </td>
                <td className="py-2 pr-3 text-right">
                  <span className="rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: TIER_COLOR[r.tier] }}>T{r.tier}</span>
                </td>
                <td className={`num py-2 pr-3 text-right ${scoreTone(r.composite_score)}`}>{fmt.n(r.composite_score)}</td>
                <td className={`num py-2 pr-3 text-right ${scoreTone(r.momentum_score)}`}>{fmt.n(r.momentum_score)}</td>
                <td className="num py-2 pr-3 text-right text-gray-300">{r.fscore ?? '–'}</td>
                <td className={`num py-2 pr-3 text-right ${r.altman_z != null && r.altman_z < 1.81 ? 'text-red-400' : 'text-gray-300'}`}>{fmt.n(r.altman_z, 1)}</td>
                <td className="num py-2 pr-3 text-right text-gray-300">{fmt.pct(r.ret_12_1, 0)}</td>
                <td className="num py-2 pr-3 text-right text-gray-300">{fmt.pctPlain(r.high52_ratio)}</td>
                <td className="num py-2 pr-3 text-right text-gray-300">{fmt.pct(r.eps_revision)}</td>
                <td className="num py-2 pr-3 text-right text-gray-300">{fmt.n(r.pe, 1)}</td>
                <td className="py-2">
                  <div className="flex flex-wrap gap-1">
                    {r.flags.map((f) => (
                      <span key={f} className={`rounded px-1.5 py-0.5 text-[10px] ${
                        FLAG_META[f]?.level === 'danger' ? 'bg-red-950 text-red-300' : FLAG_META[f]?.level === 'warn' ? 'bg-amber-950 text-amber-300' : 'bg-gray-800 text-gray-400'}`}>
                        {FLAG_META[f]?.label || f}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </div>
  )
}
