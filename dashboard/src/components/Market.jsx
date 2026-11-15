import { Fragment, useMemo, useState } from 'react'
import { Line, Scatter } from 'react-chartjs-2'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import InfoTip from './InfoTip.jsx'
import { TIER_COLOR, fmt } from '../lib.js'

export const QUAD = {
  주도: { color: '#199e70', hint: '상대강도 높고 더 강해지는 중' },
  약화: { color: '#c98500', hint: '아직 강하지만 힘이 빠지는 중' },
  소외: { color: '#6b7280', hint: '상대강도 낮고 더 약해지는 중' },
  개선: { color: '#3987e5', hint: '아직 약하지만 회복하는 중' },
}
const ZONE_TONE = { 강함: 'text-emerald-400', 중립: 'text-amber-300', 약함: 'text-red-400' }
const GRID = '#1f293766'
const TICK = '#6b7280'

const rrgPlugin = {
  id: 'rrg',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { x, y } } = chart
    const cx = x.getPixelForValue(100), cy = y.getPixelForValue(100)
    ctx.save()
    const box = (x0, y0, x1, y1, c) => { ctx.fillStyle = `${c}12`; ctx.fillRect(x0, y0, x1 - x0, y1 - y0) }
    box(cx, a.top, a.right, cy, QUAD.주도.color)
    box(cx, cy, a.right, a.bottom, QUAD.약화.color)
    box(a.left, cy, cx, a.bottom, QUAD.소외.color)
    box(a.left, a.top, cx, cy, QUAD.개선.color)
    ctx.strokeStyle = '#4b5563'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(cx, a.top); ctx.lineTo(cx, a.bottom); ctx.moveTo(a.left, cy); ctx.lineTo(a.right, cy); ctx.stroke()
    ctx.setLineDash([]); ctx.font = '11px system-ui'; ctx.fillStyle = '#9ca3af'
    ctx.textAlign = 'right'; ctx.fillText('주도 ↗', a.right - 6, a.top + 14); ctx.fillText('약화', a.right - 6, a.bottom - 6)
    ctx.textAlign = 'left'; ctx.fillText('개선', a.left + 6, a.top + 14); ctx.fillText('소외', a.left + 6, a.bottom - 6)
    ctx.restore()
  },
  afterDatasetsDraw(chart) {
    const { ctx } = chart
    ctx.save(); ctx.font = '600 11px system-ui'; ctx.textBaseline = 'bottom'
    const placed = []
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i)
      const p = meta.data[meta.data.length - 1]
      if (!p || meta.hidden) return
      ctx.textAlign = p.x > chart.chartArea.right - 80 ? 'right' : 'left'
      const dx = ctx.textAlign === 'right' ? -7 : 7
      const w = ctx.measureText(ds.label).width
      const x0 = ctx.textAlign === 'right' ? p.x + dx - w : p.x + dx
      let ty = p.y - 4
      // 겹치는 라벨은 아래로 밀어낸다
      for (let k = 0; k < 6 && placed.some((r) => x0 < r.x1 && x0 + w > r.x0 && ty > r.y0 && ty - 12 < r.y1); k++) ty += 13
      placed.push({ x0, x1: x0 + w, y0: ty - 12, y1: ty })
      ctx.lineWidth = 3; ctx.strokeStyle = '#0b0f17'; ctx.strokeText(ds.label, p.x + dx, ty)
      ctx.fillStyle = '#e5e7eb'; ctx.fillText(ds.label, p.x + dx, ty)
    })
    ctx.restore()
  },
}

function Stat({ label, value, sub, tone = 'text-white', tip }) {
  return (
    <div className="rounded-xl bg-gray-900 p-3">
      <div className="flex items-center gap-1 text-[11px] text-gray-500">{label}{tip && <InfoTip k={tip} />}</div>
      <div className={`num mt-0.5 text-2xl font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  )
}

function BreadthChart({ b, cfg }) {
  const s = b.series
  const [lo, hi] = cfg.zones
  const zoneLines = {
    id: 'zones',
    beforeDatasetsDraw(chart) {
      const { ctx, chartArea: a, scales: { y } } = chart
      ctx.save(); ctx.strokeStyle = '#4b5563'; ctx.setLineDash([3, 4]); ctx.lineWidth = 1
      for (const v of [lo, hi]) { const py = y.getPixelForValue(v * 100); ctx.beginPath(); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke() }
      ctx.restore()
    },
  }
  const base = {
    maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    elements: { point: { radius: 0, hitRadius: 8 } },
  }
  const xAxis = { ticks: { maxTicksLimit: 6, color: TICK, callback(v) { return this.getLabelForValue(v).slice(2, 7) } }, grid: { display: false } }
  const breadth = {
    labels: s.d,
    datasets: [
      { label: '200일선 위', data: s.a200.map((v) => v * 100), borderColor: '#199e70', borderWidth: 2.5 },
      { label: '50일선 위', data: s.a50.map((v) => v * 100), borderColor: '#3987e5', borderWidth: 2 },
      { label: '52주 고점 5% 이내', data: s.near.map((v) => v * 100), borderColor: '#c98500', borderWidth: 1.5, borderDash: [4, 3] },
    ],
  }
  const index = { labels: s.d, datasets: [{ label: '지수', data: s.index.map((v) => (v - 1) * 100), borderColor: '#e5e7eb', borderWidth: 1.5 }] }
  return (
    <div className="space-y-1">
      <div className="h-56">
        <Line data={breadth} plugins={[zoneLines]} options={{
          ...base,
          scales: { x: { ...xAxis, display: false }, y: { min: 0, max: 100, ticks: { stepSize: 20, color: TICK, callback: (v) => `${v}%` }, grid: { color: GRID } } },
          plugins: {
            legend: { position: 'top', align: 'start', labels: { boxWidth: 14, color: '#9ca3af' } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(0)}%` } },
          },
        }} />
      </div>
      <div className="h-24">
        <Line data={index} options={{
          ...base,
          scales: { x: xAxis, y: { ticks: { maxTicksLimit: 3, color: TICK, callback: (v) => `${v > 0 ? '+' : ''}${v}%` }, grid: { color: GRID } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `지수 ${c.raw >= 0 ? '+' : ''}${c.raw.toFixed(1)}% (기간 시작 대비)` } } },
        }} />
      </div>
    </div>
  )
}

function RRG({ groups }) {
  // 축 범위: 꼬리의 극단값 하나가 그림을 찌그러뜨리지 않게 90% 분위 + 최근 점은 반드시 포함
  const devs = groups.flatMap((g) => g.tail.flatMap(([, r, m]) => [Math.abs(r - 100), Math.abs(m - 100)])).sort((a, b) => a - b)
  const q90 = devs[Math.floor(devs.length * 0.9)] ?? 2
  const lastDev = Math.max(0, ...groups.map((g) => Math.max(Math.abs(g.ratio - 100), Math.abs(g.mom - 100))))
  const lim = Math.ceil((Math.max(2, q90, lastDev) * 1.15) / 5) * 5
  const step = lim >= 20 && lim % 10 === 0 ? 10 : 5
  const data = {
    datasets: groups.map((g) => {
      const c = QUAD[g.quadrant].color
      return {
        label: g.name, showLine: true, data: g.tail.map(([d, r, m]) => ({ x: r, y: m, d })),
        borderColor: `${c}99`, borderWidth: 1.5, backgroundColor: c,
        pointRadius: g.tail.map((_, i) => (i === g.tail.length - 1 ? 6 : 2)),
        pointHoverRadius: 7, pointBorderColor: '#0b0f17', pointBorderWidth: g.tail.map((_, i) => (i === g.tail.length - 1 ? 2 : 0)),
        quadrant: g.quadrant,
      }
    }),
  }
  const options = {
    maintainAspectRatio: false, animation: false,
    scales: {
      x: { min: 100 - lim, max: 100 + lim, title: { display: true, text: '상대강도 수준 (RS-Ratio) →', color: TICK }, ticks: { color: TICK, stepSize: step }, grid: { color: GRID } },
      y: { min: 100 - lim, max: 100 + lim, title: { display: true, text: '상대강도 변화 (RS-Momentum) →', color: TICK }, ticks: { color: TICK, stepSize: step }, grid: { color: GRID } },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label} · ${c.raw.d} · Ratio ${c.raw.x.toFixed(1)} · Mom ${c.raw.y.toFixed(1)}` } },
    },
  }
  return <div className="h-80 sm:h-96"><Scatter data={data} options={options} plugins={[rrgPlugin]} /></div>
}

function SectorTable({ groups, onSelect }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs whitespace-nowrap text-gray-500">
            <th className="sticky left-0 z-10 bg-[#111827] py-2 pr-2 font-normal">그룹</th>
            <th className="py-2 pr-2 font-normal">국면</th>
            <th className="py-2 pr-2 text-right font-normal">종목</th>
            <th className="py-2 pr-2 text-right font-normal">T1 비율</th>
            <th className="py-2 pr-2 text-right font-normal">종합</th>
            <th className="py-2 pr-2 text-right font-normal">모멘텀</th>
            <th className="py-2 pr-2 text-right font-normal"><span className="inline-flex items-center gap-1">EPS 상향<InfoTip k="eps_up" /></span></th>
            <th className="py-2 pr-2 text-right font-normal">3M</th>
            <th className="py-2 pr-2 text-right font-normal">고점 근접</th>
            <th className="py-2 text-right font-normal">200일선 위</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.name}>
              <tr onClick={() => setOpen(open === g.name ? null : g.name)} className="cursor-pointer border-b border-gray-800/50 hover:bg-gray-900/60">
                <td className="sticky left-0 z-10 bg-[#111827] py-2 pr-2 whitespace-nowrap text-gray-100">
                  <span className="inline-flex items-center gap-1">{open === g.name ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{g.name}</span>
                </td>
                <td className="py-2 pr-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5 text-gray-200"><span className="h-2.5 w-2.5 rounded-full" style={{ background: QUAD[g.quadrant].color }} />{g.quadrant}</span>
                </td>
                <td className="num py-2 pr-2 text-right text-gray-400">{g.n}</td>
                <td className="num py-2 pr-2 text-right text-gray-200">{fmt.pctPlain(g.t1_share)}</td>
                <td className="num py-2 pr-2 text-right text-gray-300">{fmt.n(g.composite)}</td>
                <td className="num py-2 pr-2 text-right text-gray-300">{fmt.n(g.momentum)}</td>
                <td className={`num py-2 pr-2 text-right ${g.eps_up >= 0.5 ? 'text-emerald-400' : 'text-gray-300'}`} title={`EPS 추정치 자료 ${g.eps_n}종목 중`}>{fmt.pctPlain(g.eps_up)}</td>
                <td className={`num py-2 pr-2 text-right ${g.ret_3m >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.pct(g.ret_3m)}</td>
                <td className="num py-2 pr-2 text-right text-gray-300">{fmt.pctPlain(g.near_high)}</td>
                <td className="num py-2 text-right text-gray-300">{fmt.pctPlain(g.above_ma200)}</td>
              </tr>
              {open === g.name && (
                <tr className="border-b border-gray-800/50">
                  <td colSpan={10} className="py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {g.members.map(([t, name, tier]) => (
                        <button key={t} onClick={() => onSelect(t)} className="flex items-center gap-1 rounded-md bg-gray-900 px-2 py-1 text-xs text-gray-200 hover:bg-gray-800">
                          <span className="rounded px-1 text-[10px] text-white" style={{ background: TIER_COLOR[tier] }}>{tier}</span>{name}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Market({ data, market, setMarket, onSelect }) {
  const [kind, setKind] = useState('sector')
  const mk = data.markets[market]
  const v = mk?.market_view
  const cfg = data.config.market
  const groups = useMemo(() => (v?.sectors || []).filter((g) => g.kind === kind), [v, kind])
  const toggle = (
    <div className="flex rounded-lg border border-gray-800 p-0.5">
      {['US', 'KR'].map((k) => (
        <button key={k} onClick={() => setMarket(k)} className={`rounded-md px-3 py-1 text-xs ${market === k ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>{k}</button>
      ))}
    </div>
  )
  if (!v || !cfg) return <div className="flex justify-end">{toggle}<p className="py-24 text-center text-gray-500">시장 데이터가 아직 없습니다.</p></div>
  const b = v.breadth
  const t1 = mk.rows.filter((r) => r.tier === 1).length
  const t1hist = v.t1_counts || []
  const macro = mk.macro
  const week = groups[0]?.week

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-medium text-gray-200">시장 — {market === 'US' ? '미국' : '한국'} 바스켓 {mk.rows.length}종목 · {b.as_of}</h2>
        <InfoTip k="breadth_scope" />
        <div className="ml-auto">{toggle}</div>
      </div>

      {macro?.available && (
        <div className="text-xs text-gray-400">
          Beta Model 국면 <b className="text-gray-200">{macro.regime} · {macro.regime_name}</b> · 주식 비중 {fmt.pctPlain(macro.equity_weight)}
          <span className="text-gray-600"> — 시장폭이 국면을 뒷받침하는지 아래에서 확인</span>
        </div>
      )}

      {b.divergence ? (
        <section className="flex gap-3 rounded-xl border border-orange-900/60 bg-orange-950/30 p-4 text-sm text-orange-100">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-orange-400" />
          <div>
            <b>시장폭 괴리</b> — 지수는 52주 고점의 {fmt.pctPlain(b.index_vs_high)} 인데 50일선 위 종목은 {fmt.pctPlain(b.a50)} (최근 3개월 고점 {fmt.pctPlain(b.a50_peak)}).
            <div className="mt-1 text-xs text-orange-200/70">소수 종목만 지수를 끌어올리는 상태. 상승 국면 후반에 자주 나타나 신규 매수·비중 확대는 보수적으로.</div>
          </div>
        </section>
      ) : (
        <section className="flex items-start gap-2 rounded-xl border border-gray-800 p-3 text-xs text-gray-400">
          <CheckCircle2 size={16} className="mt-px shrink-0 text-gray-500" />
          <span>시장폭 괴리 없음 — 지수 52주 고점 대비 {fmt.pctPlain(b.index_vs_high)}{b.index_near_high ? ' (고점 근처)' : ''} · 50일선 위 {fmt.pctPlain(b.a50)} (3개월 고점 {fmt.pctPlain(b.a50_peak)})</span>
        </section>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="200일선 위 종목" tip="breadth" value={fmt.pctPlain(b.a200)} tone={ZONE_TONE[b.zone]}
          sub={<>{b.zone}{b.a200_3m != null && <> · 3개월 전 {fmt.pctPlain(b.a200_3m)}</>}</>} />
        <Stat label="50일선 위 종목" value={fmt.pctPlain(b.a50)} sub={`3개월 고점 ${fmt.pctPlain(b.a50_peak)}`} />
        <Stat label="52주 고점 5% 이내" value={fmt.pctPlain(b.near_high)} sub="신고가권 종목 비율" />
        <Stat label="Tier 1 종목 수" value={t1}
          sub={t1hist.length >= 2 ? `${t1hist[0][0].slice(5)} ${t1hist[0][1]} → ${t1hist[t1hist.length - 1][1]}` : '이력은 자동 갱신마다 누적'} />
      </div>

      <section className="panel min-w-0 p-4">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h3 className="text-sm font-medium text-gray-300">바스켓 시장폭 1년</h3>
          <span className="text-[11px] text-gray-500">점선 = {fmt.pctPlain(cfg.zones[0])} / {fmt.pctPlain(cfg.zones[1])} (약함 · 중립 · 강함 경계, 200일선 기준)</span>
        </div>
        <BreadthChart b={b} cfg={cfg} />
      </section>

      <section className="panel min-w-0 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-gray-300">섹터 주도력 지도</h3>
          <InfoTip k="rrg" />
          {week && <span className="text-[11px] text-gray-500">주간 · {week} 주 마감 기준 · 꼬리 {cfg.rrg.tail}주</span>}
          <div className="ml-auto flex rounded-lg border border-gray-800 p-0.5">
            {[['sector', '섹터'], ['cluster', '클러스터']].map(([k, l]) => (
              <button key={k} onClick={() => setKind(k)} className={`rounded-md px-3 py-1 text-xs ${kind === k ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>{l}</button>
            ))}
          </div>
        </div>
        {groups.length ? <RRG groups={groups} /> : <p className="py-8 text-center text-xs text-gray-500">표시할 그룹이 없습니다 (그룹당 {cfg.rrg.min_members}종목 이상 필요).</p>}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400">
          {Object.entries(QUAD).map(([q, { color, hint }]) => (
            <span key={q} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /><b className="font-medium text-gray-300">{q}</b> {hint}</span>
          ))}
        </div>
      </section>

      <section className="panel min-w-0 p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-300">{kind === 'sector' ? '섹터' : '클러스터'}별 점수 · 추세 <span className="text-[11px] font-normal text-gray-500">— 행을 누르면 종목</span></h3>
        <SectorTable groups={groups} onSelect={onSelect} />
      </section>
    </div>
  )
}
