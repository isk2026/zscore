import { HelpCircle, Users, Database, AlertTriangle } from 'lucide-react'
import InfoTip from './InfoTip.jsx'
import { fmt } from '../lib.js'

const TONE = { good: 'bg-emerald-950 text-emerald-300', bad: 'bg-red-950 text-red-300', neutral: 'bg-gray-800 text-gray-300' }

export function WhyBox({ stock }) {
  const w = stock.why
  if (!w) return null
  return (
    <div className="mt-4 rounded-lg border border-gray-800 bg-gray-900/60 px-3 py-2.5">
      <div className="flex items-start gap-2 text-sm text-gray-100">
        <HelpCircle size={15} className="mt-0.5 shrink-0 text-sky-400" />
        <span><span className="text-gray-400">왜 Tier {stock.tier}? </span>{w.line}</span>
      </div>
      {w.rule && <div className="num mt-1 pl-6 text-[11px] text-gray-500">{w.rule}</div>}
      {w.notes?.map((n) => <div key={n} className="mt-1 pl-6 text-xs text-amber-300/90">{n}</div>)}
    </div>
  )
}

const signed = (x, cur) => (x == null ? '–' : `${x > 0 ? '+' : ''}${fmt.big(x, cur)}`)

export function FlowsPanel({ stock }) {
  const f = stock.flows
  if (!f) return null
  const cur = stock.currency
  const cells = f.kind === 'KR' ? [
    ['외국인 순매수', signed(f.foreign, cur), `시총의 ${fmt.pct(f.foreign_pct, 2)} · 5일 ${signed(f.foreign_5d, cur)}`, f.foreign],
    ['기관 순매수', signed(f.organ, cur), `시총의 ${fmt.pct(f.organ_pct, 2)} · 5일 ${signed(f.organ_5d, cur)}`, f.organ],
    ['개인 순매수', signed(f.individual, cur), '외국인·기관의 반대편', f.individual],
    ['외국인 보유율', fmt.pctPlain(f.hold, 2), `${f.days}일 전 대비 ${f.hold_chg == null ? '–' : `${f.hold_chg >= 0 ? '+' : ''}${(f.hold_chg * 100).toFixed(2)}%p`} · ${f.foreign_streak > 0 ? `${f.foreign_streak}일 연속 순매수` : f.foreign_streak < 0 ? `${-f.foreign_streak}일 연속 순매도` : ''}`, null],
  ] : [
    ['공매도 / 유통주식', fmt.pctPlain(f.short_float, 1), `기준 ${f.short_float != null && f.short_float >= 0.1 ? '높음' : '보통 이하'}`, null],
    ['공매도 잔고 전월 대비', fmt.pct(f.short_chg, 0), '잔고가 늘면 하락 베팅 증가', f.short_chg == null ? null : -f.short_chg],
    ['공매도 상환 일수', f.days_to_cover == null ? '–' : `${f.days_to_cover.toFixed(1)}일`, '잔고 ÷ 일평균 거래량', null],
    ['기관 보유 비율', fmt.pctPlain(f.inst, 0), '', null],
  ]
  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Users size={16} className="text-sky-400" />
        <h2 className="text-sm font-medium text-gray-300">수급 {f.kind === 'KR' ? `(최근 ${f.days}거래일)` : ''}</h2>
        <InfoTip k={f.kind === 'KR' ? 'flows_kr' : 'flows_us'} />
        <span className={`rounded px-2 py-0.5 text-xs ${TONE[f.tone]}`}>{f.signal}</span>
        <span className="ml-auto text-[11px] text-gray-500">{f.as_of} 기준 · 점수에는 미반영</span>
      </div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {cells.map(([label, v, sub, sign]) => (
          <div key={label} className="rounded-xl bg-gray-900 p-3">
            <div className="text-[11px] text-gray-500">{label}</div>
            <div className={`num mt-0.5 text-lg font-semibold ${sign == null ? 'text-white' : sign > 0 ? 'text-emerald-400' : sign < 0 ? 'text-red-400' : 'text-white'}`}>{v}</div>
            {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
          </div>
        ))}
      </div>
    </section>
  )
}

const kst = (iso) => {
  if (!iso) return '–'
  const d = new Date(iso)
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

export function QualityLine({ stock }) {
  const q = stock.quality
  if (!q) return null
  return (
    <div className="mt-3 space-y-1 text-[11px] text-gray-500">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1"><Database size={12} /> 데이터 신뢰도 <InfoTip k="quality" size={11} /></span>
        <span title={q.missing.length ? `결측: ${q.missing.join(', ')}` : '결측 없음'}>지표 {q.available}/{q.total}</span>
        <span>재무 {q.fy_end ? `${q.fy_end.slice(0, 7)} 결산` : '–'}</span>
        <span>가격 {q.price_as_of || '–'}</span>
        <span>수집 {kst(q.fetched_at)} (KST)</span>
      </div>
      {q.warn.map((w) => <div key={w} className="flex items-center gap-1 text-amber-300/90"><AlertTriangle size={12} />{w}</div>)}
    </div>
  )
}
