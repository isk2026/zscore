import { useEffect, useState } from 'react'
import { Line } from 'react-chartjs-2'
import { AlertTriangle } from 'lucide-react'
import InfoTip from './InfoTip.jsx'
import { fmt, isNumber } from '../lib.js'

// 등급 색은 lib 의 TIER_COLOR 와 동일, EW·지수는 등급과 겹치지 않는 노랑·밝은 회색 점선
const STYLE = {
  T1: { color: '#199e70', width: 2.5 },
  T1_clean: { color: '#199e70', dash: [6, 4], width: 2 },
  T2: { color: '#3987e5', width: 2 },
  T3: { color: '#d95926', width: 2 },
  T4: { color: '#6b7280', width: 2 },
  EW: { color: '#c98500', dash: [3, 3], width: 2 },
  INDEX: { color: '#e5e7eb', dash: [1, 3], width: 2 },
}
const ORDER = ['T1', 'T1_clean', 'T2', 'T3', 'T4', 'EW', 'INDEX']

function Equity({ m }) {
  const data = {
    labels: m.dates,
    datasets: ORDER.map((k) => ({
      label: m.series[k].label,
      data: [1, ...m.series[k].equity],
      borderColor: STYLE[k].color, backgroundColor: STYLE[k].color,
      borderDash: STYLE[k].dash, borderWidth: STYLE[k].width,
      pointRadius: 0, pointHoverRadius: 4, tension: 0.15,
    })),
  }
  const options = {
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { ticks: { maxTicksLimit: 8, color: '#6b7280' }, grid: { display: false } },
      y: { ticks: { color: '#6b7280', callback: (v) => `${((v - 1) * 100).toFixed(0)}%` }, grid: { color: '#1f293766' } },
    },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 14, color: '#9ca3af' } },
      tooltip: {
        itemSort: (a, b) => b.raw - a.raw,
        callbacks: { label: (c) => `${c.dataset.label}: ${fmt.pct(c.raw - 1, 1)}` },
      },
    },
  }
  return <div className="h-96"><Line data={data} options={options} /></div>
}

const COLS = [
  ['cagr', '연환산', 'cagr', (v) => fmt.pct(v)],
  ['total', '누적', null, (v) => fmt.pct(v, 0)],
  ['vol', '변동성', null, (v) => fmt.pctPlain(v)],
  ['sharpe', '샤프', 'sharpe', (v) => fmt.n(v)],
  ['mdd', 'MDD', 'mdd', (v) => fmt.pct(v)],
  ['avg_holdings', '평균 종목수', null, (v) => fmt.n(v, 1)],
  ['turnover', '월 회전율', 'turnover', (v) => fmt.pctPlain(v)],
  ['beat_ew', 'EW 대비 승률', 'beat', (v) => fmt.pctPlain(v)],
]

function IcCard({ label, ic }) {
  const good = isNumber(ic.mean) && ic.mean > 0
  return (
    <div className="panel min-w-0 p-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">{label} IC <InfoTip k="ic" /></div>
      <div className={`num mt-1 text-2xl font-semibold ${good ? 'text-emerald-400' : 'text-orange-400'}`}>{fmt.n(ic.mean, 3)}</div>
      <div className="mt-1 text-xs text-gray-500">t {fmt.n(ic.t, 1)} · 적중률 {fmt.pctPlain(ic.hit)}</div>
    </div>
  )
}

export default function Backtest({ market, setMarket }) {
  const [bt, setBt] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    fetch(`./data/backtest.json?t=${Date.now()}`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json() })
      .then(setBt).catch((e) => setErr(`backtest.json 을 불러오지 못했습니다 (${e.message}) — python -m zscore.backtest 실행`))
  }, [])
  if (err) return <div className="py-16 text-center text-sm text-gray-500">{err}</div>
  if (!bt) return <div className="py-16 text-center text-gray-500">불러오는 중…</div>
  const m = bt.markets[market]
  if (!m) return <div className="py-16 text-center text-gray-500">{market} 백테스트 없음</div>
  const a = bt.assumptions

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-gray-200">
          월간 리밸런싱 백테스트 · {m.start} ~ {m.end} ({m.months}개월)
        </h2>
        <div className="ml-auto flex rounded-lg border border-gray-800 p-0.5">
          {['US', 'KR'].map((k) => (
            <button key={k} onClick={() => setMarket(k)} className={`rounded-md px-3 py-1 text-xs ${market === k ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>{k}</button>
          ))}
        </div>
      </div>

      <section className="flex gap-3 rounded-xl border border-amber-900/60 bg-amber-950/20 p-4 text-sm text-amber-100/90">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-400" />
        <div>
          <div className="font-medium">해석 주의 — 참고용 검증이며 미래 성과를 보장하지 않습니다</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-amber-100/70">
            {a.caveats.map((c) => <li key={c}>{c}</li>)}
            <li>제외 지표: {a.excluded.join(', ')} · 재무는 회계연도 종료 후 {a.report_lag_days}일부터 반영 · 거래비용 편도 {a.cost_one_way * 1e4}bp</li>
          </ul>
        </div>
      </section>

      <section className="panel min-w-0 p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-300">누적 수익률 (범례를 누르면 숨기기)</h3>
        <Equity m={m} />
      </section>

      <section className="grid grid-cols-2 gap-3">
        <IcCard label="종합 점수" ic={m.ic.composite} />
        <IcCard label="모멘텀 점수" ic={m.ic.momentum} />
      </section>

      <section className="panel min-w-0 p-4">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="sticky left-0 z-10 bg-[#111827] py-2 pr-3 font-normal">포트폴리오</th>
              {COLS.map(([k, l, tip]) => (
                <th key={k} className="py-2 pr-3 text-right font-normal">{l}{tip && <InfoTip k={tip} size={11} className="ml-0.5" />}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ORDER.map((k) => {
              const s = m.series[k]
              return (
                <tr key={k} className="border-b border-gray-800/50">
                  <td className="sticky left-0 z-10 bg-[#111827] py-2 pr-3">
                    <span className="mr-2 inline-block h-0.5 w-5 align-middle" style={{ background: STYLE[k].color }} />
                    <span className="text-gray-200">{s.label}</span>
                  </td>
                  {COLS.map(([c, , , f]) => <td key={c} className="num py-2 pr-3 text-right text-gray-300">{f(s.stats[c])}</td>)}
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
        <p className="mt-2 text-[11px] text-gray-600">
          {a.rebalance}. 해당 등급이 빈 달은 현금(0%). 지수는 가격지수(배당 제외), 종목은 배당 포함 수정주가.
        </p>
      </section>

      <section className="panel min-w-0 p-4">
        <h3 className="mb-2 text-sm font-medium text-gray-300">최근 리밸런싱 시점의 Tier 1 구성</h3>
        <div className="space-y-2 text-xs">
          {[...m.tier1_history].reverse().map((h) => (
            <div key={h.date} className="flex gap-3">
              <span className="num w-20 shrink-0 text-gray-500">{h.date}</span>
              <span className="text-gray-300">{h.T1.map((t) => m.names[t] || t).join(' · ') || '(없음)'}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
