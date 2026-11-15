import { useState } from 'react'
import { Download, Compass } from 'lucide-react'
import InfoTip from './InfoTip.jsx'
import { TIER_COLOR, fmt, LS } from '../lib.js'

const REGIME_TONE = { 1: 'text-emerald-300', 2: 'text-amber-300', 3: 'text-orange-300', 4: 'text-red-300' }

export function RegimeChip({ mk, label }) {
  const m = mk?.macro
  if (!m) return null
  return (
    <span className="whitespace-nowrap">
      {label} {m.available
        ? <><span className={REGIME_TONE[m.regime]}>국면 {m.regime} {m.regime_name}</span> · 주식 {fmt.pctPlain(m.equity_weight)}</>
        : <span className="text-gray-500">Beta 미연결</span>}
    </span>
  )
}

function BudgetBar({ model }) {
  const segs = [
    ...[1, 2, 3].map((t) => ({ k: `T${t}`, w: model.holdings.filter((h) => h.tier === t).reduce((a, h) => a + h.weight, 0), c: TIER_COLOR[t] })),
    { k: '울타리 현금', w: model.fence_cash, c: '#374151' },
    { k: '현금 (Beta)', w: 1 - model.equity_weight, c: '#1f2937' },
  ].filter((s) => s.w > 0.0005)
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-full">
        {segs.map((s, i) => <div key={s.k} title={`${s.k} ${fmt.pctPlain(s.w, 1)}`} style={{ width: `${s.w * 100}%`, background: s.c, marginLeft: i ? 2 : 0 }} />)}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-400">
        {segs.map((s) => (
          <span key={s.k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: s.c }} />{s.k} {fmt.pctPlain(s.w, 1)}</span>
        ))}
      </div>
    </div>
  )
}

export default function ModelPortfolio({ data, onLoad }) {
  const [split, setSplit] = useState(() => LS.get('zs.usShare', 0.5))
  const [mkt, setMkt] = useState('US')
  const mk = data.markets[mkt]
  const model = mk?.model
  const macro = mk?.macro
  if (!model) return null
  const budget = model.tier_budget

  const load = () => {
    LS.set('zs.usShare', split)
    const items = []
    for (const [m, share] of [['US', split], ['KR', 1 - split]]) {
      if (share <= 0) continue
      for (const h of data.markets[m]?.model?.holdings || []) {
        items.push({ ticker: h.ticker, w: Math.round(h.weight * share * 1000) / 10 })
      }
    }
    onLoad(items)
  }

  return (
    <section className="panel min-w-0 space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Compass size={18} className="text-sky-400" />
        <h2 className="text-sm font-medium text-gray-200">모델 포트폴리오 — Beta Model 국면 × 4-Tier</h2>
        <InfoTip k="model" />
        <div className="ml-auto flex rounded-lg border border-gray-800 p-0.5">
          {['US', 'KR'].map((k) => (
            <button key={k} onClick={() => setMkt(k)} className={`rounded-md px-3 py-1 text-xs ${mkt === k ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>{k}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-gray-900 p-3">
          <div className="text-[11px] text-gray-500">시장 국면 (Beta Model {macro.as_of || ''})</div>
          <div className={`mt-0.5 text-base font-semibold ${REGIME_TONE[macro.regime] || 'text-gray-300'}`}>
            {macro.available ? `${macro.regime} · ${macro.regime_name}` : 'Beta Model 미연결'}
          </div>
          {macro.regime_summary && <div className="mt-1 text-[11px] leading-snug text-gray-500">{macro.regime_summary}</div>}
        </div>
        <div className="rounded-xl bg-gray-900 p-3">
          <div className="text-[11px] text-gray-500">주식 비중 (다음 거래일)</div>
          <div className="num mt-0.5 text-2xl font-semibold text-white">{fmt.pctPlain(model.equity_weight)}</div>
          <div className="text-[11px] text-gray-500">실제 편입 {fmt.pctPlain(model.invested, 1)} · 현금 {fmt.pctPlain(model.cash, 1)}</div>
        </div>
        <div className="rounded-xl bg-gray-900 p-3">
          <div className="text-[11px] text-gray-500">주식 몫 안의 Tier 예산 (국면 {model.regime})</div>
          <div className="mt-1 space-y-0.5 text-xs">
            {[1, 2, 3].map((t) => (
              <div key={t} className="flex justify-between">
                <span style={{ color: TIER_COLOR[t] }}>T{t} {data.config.tiers[t].name}</span>
                <span className="num text-gray-300">{fmt.pctPlain(budget[t] ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <BudgetBar model={model} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
              <th className="py-2 pr-2 font-normal">종목</th>
              <th className="hidden py-2 pr-2 font-normal sm:table-cell">섹터</th>
              <th className="py-2 pr-2 text-right font-normal">종합</th>
              <th className="py-2 pr-2 text-right font-normal">모멘텀</th>
              <th className="py-2 text-right font-normal">비중</th>
            </tr>
          </thead>
          <tbody>
            {model.holdings.map((h) => (
              <tr key={h.ticker} className="border-b border-gray-800/50">
                <td className="max-w-0 py-1.5 pr-2 sm:max-w-none">
                  <div className="flex items-center gap-2">
                    <span className="rounded px-1 text-[10px] font-medium text-white" style={{ background: TIER_COLOR[h.tier] }}>T{h.tier}</span>
                    <span className="truncate text-gray-100">{h.name}</span>
                  </div>
                </td>
                <td className="hidden py-1.5 pr-2 text-xs text-gray-400 sm:table-cell">{h.sector}</td>
                <td className="num py-1.5 pr-2 text-right text-gray-300">{fmt.n(h.composite)}</td>
                <td className="num py-1.5 pr-2 text-right text-gray-300">{fmt.n(h.momentum)}</td>
                <td className="num py-1.5 text-right font-medium text-gray-100">{fmt.pctPlain(h.weight, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {model.excluded.length > 0 && (
        <div className="text-xs text-gray-500">
          <span className="text-gray-400">심각 경고로 제외:</span>{' '}
          {model.excluded.map((x) => `${x.name}(T${x.tier}, ${x.why.join('·')})`).join(' · ')}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-gray-800 pt-3">
        <label className="flex flex-1 items-center gap-2 text-xs text-gray-400">
          미국 {fmt.pctPlain(split)} · 한국 {fmt.pctPlain(1 - split)}
          <input type="range" min="0" max="1" step="0.05" value={split} onChange={(e) => setSplit(Number(e.target.value))} className="h-7 min-w-24 flex-1" />
        </label>
        <button onClick={load} className="flex items-center gap-1.5 rounded-lg bg-sky-800 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700">
          <Download size={14} /> 아래 보유 종목으로 불러오기
        </button>
      </div>
    </section>
  )
}
