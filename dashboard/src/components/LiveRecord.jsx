import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { NotebookPen } from 'lucide-react'
import InfoTip from './InfoTip.jsx'
import { TIER_COLOR, fmt } from '../lib.js'

const SERIES = [
  ['model', '모델 포트폴리오', '#3987e5', undefined],
  ['t1', 'Tier 1 동일가중', TIER_COLOR[1], undefined],
  ['ew', '유니버스 동일가중', '#c98500', [3, 3]],
  ['index', '지수', '#e5e7eb', [1, 3]],
]

export default function LiveRecord({ market, data }) {
  const [rec, setRec] = useState(undefined)
  useEffect(() => {
    fetch(`./data/live.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).then(setRec).catch(() => setRec(null))
  }, [])
  if (rec === undefined) return null
  const m = rec?.[market]
  const header = (
    <div className="mb-2 flex flex-wrap items-center gap-2">
      <NotebookPen size={16} className="text-sky-400" />
      <h2 className="text-sm font-medium text-gray-200">실전 기록 (가상 포트폴리오)</h2>
      <InfoTip k="live" />
      {m && <span className="text-[11px] text-gray-500">{m.start} 시작 · {m.nav.length}개 기준일 · 리밸런싱 {m.rebalances.length}회</span>}
    </div>
  )
  if (!m) {
    return (
      <section className="panel p-4">
        {header}
        <p className="text-xs text-gray-500">다음 자동 갱신부터 기록이 시작됩니다. 백테스트와 달리 생존 편향이 없는 유일한 검증이라, 6~12개월 쌓이면 가장 믿을 만한 근거가 됩니다.</p>
      </section>
    )
  }
  const last = m.nav[m.nav.length - 1]
  const reb = m.rebalances[m.rebalances.length - 1]
  const prices = Object.fromEntries(Object.entries(data.markets[market]?.stocks || {}).map(([t, s]) => [t, s.price]))
  const names = Object.fromEntries(Object.entries(data.markets[market]?.stocks || {}).map(([t, s]) => [t, s.name]))

  const chart = {
    labels: m.nav.map((r) => r.date),
    datasets: SERIES.map(([k, label, color, dash]) => ({
      label, data: m.nav.map((r) => r[k]), borderColor: color, backgroundColor: color, borderDash: dash,
      borderWidth: k === 'model' ? 2.5 : 2, pointRadius: m.nav.length < 30 ? 2 : 0, tension: 0.15,
    })),
  }
  const options = {
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { ticks: { maxTicksLimit: 6, color: '#6b7280' }, grid: { display: false } },
      y: { ticks: { color: '#6b7280', callback: (v) => `${((v - 1) * 100).toFixed(1)}%` }, grid: { color: '#1f293766' } },
    },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 14, color: '#9ca3af' } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.pct(c.raw - 1, 2)}` } },
    },
  }

  return (
    <section className="panel min-w-0 space-y-4 p-4">
      {header}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {SERIES.map(([k, label, color]) => (
          <div key={k} className="rounded-xl bg-gray-900 p-3">
            <div className="flex items-center gap-1.5 text-[11px] text-gray-500"><span className="h-2 w-2 rounded-sm" style={{ background: color }} />{label}</div>
            <div className={`num mt-0.5 text-lg font-semibold ${last[k] >= 1 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.pct(last[k] - 1, 2)}</div>
          </div>
        ))}
      </div>
      {m.nav.length >= 2
        ? <div className="h-64"><Line data={chart} options={options} /></div>
        : <p className="text-xs text-gray-500">기준일이 2개 이상 쌓이면 수익률 곡선이 표시됩니다.</p>}

      <div>
        <h3 className="mb-1 text-xs font-medium text-gray-400">
          현재 모델 보유 ({reb.date} 편입 · 국면 {reb.regime ?? '–'} · 주식 {fmt.pctPlain(reb.equity_weight)} · 현금 {fmt.pctPlain(reb.cash)})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                <th className="py-1.5 pr-2 font-normal">종목</th>
                <th className="py-1.5 pr-2 text-right font-normal">비중</th>
                <th className="py-1.5 pr-2 text-right font-normal">편입가</th>
                <th className="py-1.5 text-right font-normal">수익</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(reb.holdings).sort((a, b) => b[1].w - a[1].w).map(([t, h]) => {
                const r = prices[t] ? prices[t] / h.p - 1 : null
                return (
                  <tr key={t} className="border-b border-gray-800/50">
                    <td className="max-w-0 py-1.5 pr-2 sm:max-w-none">
                      <div className="flex items-center gap-2">
                        {h.tier && <span className="rounded px-1 text-[10px] text-white" style={{ background: TIER_COLOR[h.tier] }}>T{h.tier}</span>}
                        <span className="truncate text-gray-200">{names[t] || t}</span>
                      </div>
                    </td>
                    <td className="num py-1.5 pr-2 text-right text-gray-300">{fmt.pctPlain(h.w, 1)}</td>
                    <td className="num py-1.5 pr-2 text-right text-gray-400">{fmt.price(h.p, market === 'KR' ? 'KRW' : 'USD')}</td>
                    <td className={`num py-1.5 text-right ${r == null ? 'text-gray-500' : r >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.pct(r)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">
          매월 첫 기준일에 그 시점의 모델 포트폴리오로 리밸런싱 (거래비용 편도 10bp), 그 사이에는 매 기준일 종가로 평가. 현금 수익은 0으로 계산.
        </p>
      </div>
    </section>
  )
}
