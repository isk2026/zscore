import { Radar } from 'react-chartjs-2'
import { GitCompare, X } from 'lucide-react'
import { TIER_COLOR, fmt, scoreTone } from '../lib.js'

export const MAX_COMPARE = 4
// 비교 계열 색 (등급 색과 겹치지 않게): 파랑 · 주황 · 보라 · 청록
export const CMP_COLORS = ['#5b9cf0', '#e07b39', '#a77bf3', '#2bb3a6']
const FACTOR_ORDER = ['cashflow', 'growth', 'profitability', 'stability', 'valuation', 'momentum']

const TONE = { good: 'text-emerald-400', bad: 'text-red-400', neutral: 'text-gray-300' }

export default function Compare({ data, list, setList, onSelect }) {
  const find = (t) => Object.values(data.markets).map((m) => m.stocks[t]).find(Boolean)
  const stocks = list.map(find).filter(Boolean)
  if (!list.length) return null
  const labels = data.config.factor_labels
  const mixed = new Set(stocks.map((s) => s.market)).size > 1

  const radar = {
    labels: FACTOR_ORDER.map((f) => labels[f]),
    datasets: [
      ...stocks.map((s, i) => ({
        label: s.name, data: FACTOR_ORDER.map((f) => s.factor_scores?.[f] ?? null),
        borderColor: CMP_COLORS[i], backgroundColor: `${CMP_COLORS[i]}22`, borderWidth: 2,
        pointRadius: 3, pointBackgroundColor: CMP_COLORS[i], pointBorderColor: '#111827', pointBorderWidth: 2,
      })),
      { label: '바스켓 평균 (3.0)', data: FACTOR_ORDER.map(() => 3), borderColor: '#6b7280', borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
    ],
  }
  const opts = {
    maintainAspectRatio: false,
    scales: { r: { min: 1, max: 5, ticks: { stepSize: 1, backdropColor: 'transparent', color: '#6b7280' },
      grid: { color: '#1f2937' }, angleLines: { color: '#1f2937' }, pointLabels: { color: '#d1d5db', font: { size: 12 } } } },
    plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, color: '#9ca3af' } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n(c.raw)}점` } } },
  }

  const rows = [
    ['등급', (s) => <span className="rounded px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: TIER_COLOR[s.tier] }}>T{s.tier}</span>],
    ['종합 점수', (s) => <span className={scoreTone(s.composite_score)}>{fmt.n(s.composite_score)}</span>],
    ['모멘텀 점수', (s) => <span className={scoreTone(s.momentum_score)}>{fmt.n(s.momentum_score)}</span>],
    ...FACTOR_ORDER.map((f) => [`· ${labels[f]}`, (s) => <span className={scoreTone(s.factor_scores?.[f])}>{fmt.n(s.factor_scores?.[f])}</span>]),
    ['F-Score', (s) => s.fscore ?? '–'],
    ['Altman Z', (s) => <span className={s.altman_z != null && s.altman_z < 1.81 ? 'text-red-400' : ''}>{fmt.n(s.altman_z, 1)}</span>],
    ['12-1M 수익률', (s) => fmt.pct(s.ret_12_1, 0)],
    ['52주 고점 대비', (s) => fmt.pctPlain(s.high52_ratio)],
    ['EPS 추정치 30일', (s) => fmt.pct(s.eps_revision)],
    ['PER', (s) => fmt.n(s.pe, 1)],
    ['시가총액', (s) => fmt.big(s.market_cap, s.currency)],
    ['수급', (s) => <span className={TONE[s.flows?.tone] || 'text-gray-500'}>{s.flows?.signal || '–'}</span>],
    ['경고', (s) => (s.flags || []).filter((f) => f.level === 'danger').map((f) => f.title).join(', ') || '–'],
  ]

  return (
    <section className="panel min-w-0 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompare size={16} className="text-sky-400" />
        <h2 className="text-sm font-medium text-gray-200">종목 비교</h2>
        <span className="text-[11px] text-gray-500">최대 {MAX_COMPARE}종목 · 표의 ＋ 또는 종목 분석의 "비교에 추가"</span>
        <button onClick={() => setList([])} className="ml-auto text-xs text-gray-500 hover:text-gray-300">모두 지우기</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {list.map((t, i) => {
          const s = find(t)
          return (
            <span key={t} className="flex items-center gap-1.5 rounded-lg border border-gray-800 py-1 pr-1 pl-2 text-xs text-gray-200">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: CMP_COLORS[i] }} />
              <button onClick={() => onSelect(t)} className="hover:underline">{s?.name || t}</button>
              <button aria-label={`${s?.name || t} 비교에서 빼기`} onClick={() => setList(list.filter((x) => x !== t))}
                className="rounded p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-200"><X size={12} /></button>
            </span>
          )
        })}
      </div>
      {stocks.length < 2 ? <p className="text-xs text-gray-500">한 종목 더 추가하면 비교가 표시됩니다.</p> : <>
        {mixed && <p className="text-[11px] text-amber-300/80">미국·한국 종목이 섞여 있습니다 — 점수는 각자 시장 바스켓 안의 상대 점수입니다.</p>}
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="h-80 lg:col-span-2"><Radar data={radar} options={opts} /></div>
          <div className="min-w-0 overflow-x-auto lg:col-span-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500">
                  <th className="sticky left-0 z-10 bg-[#111827] py-2 pr-2 text-left font-normal" />
                  {stocks.map((s, i) => (
                    <th key={s.ticker} className="min-w-[6.5rem] py-2 pr-2 text-right font-normal">
                      <span className="inline-flex items-center gap-1 text-gray-200"><span className="h-2 w-2 rounded-full" style={{ background: CMP_COLORS[i] }} />
                        <span className="max-w-[7rem] truncate">{s.name}</span></span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, f]) => (
                  <tr key={label} className="border-b border-gray-800/50">
                    <td className="sticky left-0 z-10 bg-[#111827] py-1.5 pr-2 text-xs whitespace-nowrap text-gray-400">{label}</td>
                    {stocks.map((s) => <td key={s.ticker} className="num py-1.5 pr-2 text-right text-gray-200">{f(s)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="space-y-1">
          {stocks.map((s, i) => s.why && (
            <p key={s.ticker} className="flex gap-2 text-xs text-gray-400">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: CMP_COLORS[i] }} />
              <span><b className="font-medium text-gray-200">{s.name}</b> — {s.why.line}</span>
            </p>
          ))}
        </div>
      </>}
    </section>
  )
}
