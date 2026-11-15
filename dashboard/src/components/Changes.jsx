import { History } from 'lucide-react'
import { TIER_COLOR } from '../lib.js'

const KIND = {
  enter_t1: { label: 'Tier 1 진입', cls: 'text-emerald-300' },
  exit_t1: { label: 'Tier 1 이탈', cls: 'text-red-300' },
  up: { label: '등급 상향', cls: 'text-sky-300' },
  down: { label: '등급 하향', cls: 'text-orange-300' },
  flag: { label: '새 위험 경고', cls: 'text-amber-300' },
}
const FLAG = { momentum_crash: '모멘텀 크러시', theme_hype: '테마 과열', bankruptcy: '부실 위험' }

export default function Changes({ mk, onSelect }) {
  const ch = mk?.changes
  if (!ch) return null
  const groups = {}
  for (const c of ch.items) (groups[c.kind] ||= []).push(c)
  return (
    <section className="panel min-w-0 p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <History size={16} className="self-center text-sky-400" />
        <h2 className="text-sm font-medium text-gray-300">최근 등급 변화</h2>
        {ch.prev && <span className="text-[11px] text-gray-500">{ch.prev} → {ch.as_of}</span>}
      </div>
      {!ch.prev ? (
        <p className="text-xs text-gray-500">
          등급 이력은 자동 갱신 때마다 기록됩니다 (기록 시작 {ch.as_of || '다음 갱신'}). 두 번째 기준일부터 변화가 표시되고 텔레그램으로도 알립니다.
        </p>
      ) : ch.items.length === 0 ? (
        <p className="text-xs text-gray-500">직전 기준일 대비 등급 변화가 없습니다.</p>
      ) : (
        <div className="space-y-2">
          {Object.keys(KIND).filter((k) => groups[k]).map((k) => (
            <div key={k} className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className={`w-24 shrink-0 font-medium ${KIND[k].cls}`}>{KIND[k].label}</span>
              {groups[k].map((c) => (
                <button key={c.ticker + k} onClick={() => onSelect(c.ticker)}
                  className="flex items-center gap-1 rounded-md bg-gray-900 px-2 py-1 text-gray-200 hover:bg-gray-800">
                  {c.name}
                  {k === 'flag' ? <span className="text-amber-300/80">{c.flags.map((f) => FLAG[f] || f).join('·')}</span> : (
                    <span className="flex items-center gap-0.5 text-[10px]">
                      <span className="rounded px-1 text-white" style={{ background: TIER_COLOR[c.from] }}>{c.from}</span>→
                      <span className="rounded px-1 text-white" style={{ background: TIER_COLOR[c.to] }}>{c.to}</span>
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function TierTimeline({ mk, ticker }) {
  const tl = mk?.timeline
  const s = tl?.tiers?.[ticker]
  if (!s || s.length < 2) return null
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-[10px] text-gray-500">
        <span>등급 이력 {tl.dates[0]}</span><span>{tl.dates[tl.dates.length - 1]}</span>
      </div>
      <div className="flex h-3 gap-px overflow-hidden rounded">
        {[...s].map((c, i) => (
          <div key={tl.dates[i]} title={`${tl.dates[i]} · ${c === '-' ? '기록 없음' : `Tier ${c}`}`}
            className="flex-1" style={{ background: c === '-' ? '#1f2937' : TIER_COLOR[c] }} />
        ))}
      </div>
    </div>
  )
}
