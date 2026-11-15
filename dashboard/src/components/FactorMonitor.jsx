import { Gauge } from 'lucide-react'
import InfoTip from './InfoTip.jsx'
import { fmt } from '../lib.js'

const ORDER = ['cashflow', 'growth', 'profitability', 'stability', 'valuation', 'momentum']
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const tstat = (xs) => {
  const v = xs.filter((x) => x != null)
  if (v.length < 3) return null
  const m = mean(v), sd = Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1))
  return sd ? (m / sd) * Math.sqrt(v.length) : null
}
const cum = (xs) => xs.reduce((a, x) => a * (1 + (x ?? 0)), 1) - 1

// IC 색: 음(파랑) ← 0(회색) → 양(초록). ±0.3 에서 최대
function icColor(v) {
  if (v == null) return '#111827'
  const t = Math.min(1, Math.abs(v) / 0.3)
  const [r0, g0, b0] = [55, 65, 81]
  const [r1, g1, b1] = v >= 0 ? [25, 158, 112] : [57, 135, 229]
  const m = (a, b) => Math.round(a + (b - a) * t)
  return `rgb(${m(r0, r1)},${m(g0, g1)},${m(b0, b1)})`
}

export default function FactorMonitor({ m }) {
  const f = m.factors
  if (!f) return null
  const dates = m.dates.slice(1) // 각 기간의 끝 월
  const N = 12
  const recentDates = dates.slice(-N)
  const rows = ORDER.filter((k) => f.ic[k]).map((k) => {
    const ic = f.ic[k], sp = f.spread[k]
    return {
      k, label: f.labels[k], ic3: mean(ic.slice(-3)), ic6: mean(ic.slice(-6)), icAll: mean(ic), t: tstat(ic),
      sp6: cum(sp.slice(-6)), spAll: cum(sp), strip: ic.slice(-N),
    }
  })
  const best = [...rows].sort((a, b) => (b.ic6 ?? -9) - (a.ic6 ?? -9))[0]

  return (
    <section className="panel min-w-0 space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Gauge size={16} className="text-sky-400" />
        <h3 className="text-sm font-medium text-gray-300">팩터 성과 모니터 — 요즘 시장은 무엇에 보상하나</h3>
        <InfoTip k="factor_monitor" />
      </div>
      {best?.ic6 != null && (
        <p className="text-xs text-gray-400">
          최근 6개월 가장 잘 통한 팩터는 <b className="text-gray-100">{best.label}</b> (평균 IC {best.ic6.toFixed(3)}).
          {' '}최근 역효과: {rows.filter((r) => r.ic6 != null && r.ic6 < 0).map((r) => r.label).join('·') || '없음'}.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs whitespace-nowrap text-gray-500">
              <th className="sticky left-0 z-10 bg-[#111827] py-2 pr-2 text-left font-normal">팩터</th>
              <th className="py-2 pr-2 text-right font-normal">IC 3개월</th>
              <th className="py-2 pr-2 text-right font-normal">IC 6개월</th>
              <th className="py-2 pr-2 text-right font-normal">IC 전체 (t)</th>
              <th className="py-2 pr-2 text-right font-normal">상−하위 6개월</th>
              <th className="py-2 pr-2 text-left font-normal">월별 IC (최근 {recentDates.length}개월)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.k} className="border-b border-gray-800/50">
                <td className="sticky left-0 z-10 bg-[#111827] py-1.5 pr-2 whitespace-nowrap text-gray-200">{r.label}</td>
                {[r.ic3, r.ic6].map((v, i) => (
                  <td key={i} className={`num py-1.5 pr-2 text-right ${v == null ? 'text-gray-600' : v > 0.02 ? 'text-emerald-400' : v < -0.02 ? 'text-sky-400' : 'text-gray-300'}`}>{v == null ? '–' : v.toFixed(3)}</td>
                ))}
                <td className="num py-1.5 pr-2 text-right whitespace-nowrap text-gray-300">{r.icAll == null ? '–' : r.icAll.toFixed(3)} <span className="text-gray-500">({r.t == null ? '–' : r.t.toFixed(1)})</span></td>
                <td className={`num py-1.5 pr-2 text-right ${r.sp6 >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.pct(r.sp6)}</td>
                <td className="py-1.5 pr-2">
                  <div className="flex gap-px">
                    {r.strip.map((v, i) => (
                      <div key={recentDates[i]} title={`${recentDates[i]?.slice(0, 7)} · IC ${v == null ? '–' : v.toFixed(2)}`}
                        className="h-4 w-4 shrink-0 rounded-[2px]" style={{ background: icColor(v) }} />
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
        <span>IC −0.3</span>
        <div className="h-2 w-28 rounded" style={{ background: `linear-gradient(90deg, ${icColor(-0.3)}, ${icColor(0)}, ${icColor(0.3)})` }} />
        <span>+0.3</span>
        <span className="ml-2">상−하위 = 팩터 상위 1/3 − 하위 1/3 다음 달 수익 차이의 누적. 모멘텀 팩터는 EPS 수정 제외(과거 자료 없음).</span>
      </div>
    </section>
  )
}
