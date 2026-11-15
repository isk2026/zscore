import { Radar, Line } from 'react-chartjs-2'
import { AlertTriangle, ShieldAlert, Info, CheckCircle2, XCircle, MinusCircle, Zap } from 'lucide-react'
import { TIER_COLOR, FLAG_META, fmt, isNumber, scoreTone } from '../lib.js'
import InfoTip from './InfoTip.jsx'

const FACTOR_ORDER = ['cashflow', 'growth', 'profitability', 'stability', 'valuation', 'momentum']

const METRIC_LABEL = {
  fcf_to_assets: ['FCF/총자산', 'pct'], ocf_to_assets: ['영업CF/총자산', 'pct'], accruals: ['발생액/총자산 (낮을수록 ↑)', 'pct'],
  revenue_growth: ['매출 성장률', 'pct'], earnings_growth: ['순이익 성장률', 'pct'],
  roe: ['ROE', 'pct'], roa: ['ROA', 'pct'], gross_margin: ['매출총이익률', 'pct'],
  fscore: ['Piotroski F-Score', 'int'], altman_z_capped: ['Altman Z (상한 10)', 'n'], debt_to_equity: ['부채/자본 (낮을수록 ↑)', 'n'],
  earnings_yield: ['이익수익률 (1/PER)', 'pct'], fcf_yield: ['FCF 수익률', 'pct'], book_to_price: ['B/P (1/PBR)', 'n'],
  ret_12_1: ['12-1M 수익률', 'pct'], high52_ratio: ['52주 고점 대비', 'pctPlain'], rel_strength: ['6M 상대강도 (vs 지수)', 'pct'],
  eps_revision: ['EPS 추정치 30일 변화', 'pct'],
}
const METRIC_TIP = {
  fscore: 'fscore', altman_z_capped: 'altman', ret_12_1: 'ret_12_1', high52_ratio: 'high52',
  rel_strength: 'rel_strength', eps_revision: 'eps_revision',
}
const FACTOR_TIP = { momentum: 'momentum_factor' }

const FACTOR_METRICS = {
  cashflow: ['fcf_to_assets', 'ocf_to_assets', 'accruals'],
  growth: ['revenue_growth', 'earnings_growth'],
  profitability: ['roe', 'roa', 'gross_margin'],
  stability: ['fscore', 'altman_z_capped', 'debt_to_equity'],
  valuation: ['earnings_yield', 'fcf_yield', 'book_to_price'],
  momentum: ['ret_12_1', 'high52_ratio', 'rel_strength', 'eps_revision'],
}

function fmtMetric(v, kind) {
  if (!isNumber(v)) return '–'
  if (kind === 'pct') return fmt.pct(v)
  if (kind === 'pctPlain') return fmt.pctPlain(v, 1)
  if (kind === 'int') return String(Math.round(v))
  return fmt.n(v)
}

export function TierBadge({ tier, tiers, size = 'lg' }) {
  const t = tiers[tier]
  const big = size === 'lg'
  return (
    <div className={`inline-flex items-center gap-3 rounded-xl ${big ? 'px-4 py-3' : 'px-2 py-1'}`}
      style={{ background: `${TIER_COLOR[tier]}22`, border: `1px solid ${TIER_COLOR[tier]}88` }}>
      <span className={`flex items-center justify-center rounded-lg font-bold text-white ${big ? 'h-11 w-11 text-xl' : 'h-6 w-6 text-xs'}`}
        style={{ background: TIER_COLOR[tier] }}>{tier}</span>
      <div className="leading-tight">
        <div className={`font-semibold text-white ${big ? 'text-lg' : 'text-sm'}`}>Tier {tier} · {t.name}{big && <InfoTip k="tier" className="ml-1" />}</div>
        {big && <div className="text-xs text-gray-400">{t.en} — {t.action}</div>}
      </div>
    </div>
  )
}

function MetricCard({ label, value, sub, tone, tip }) {
  return (
    <div className="panel min-w-0 p-4">
      <div className="flex items-center gap-1 text-xs text-gray-400">{label}<InfoTip k={tip} /></div>
      <div className={`num mt-1 text-3xl font-semibold ${tone}`}>{value}</div>
      <div className="mt-1 truncate text-xs text-gray-500" title={sub}>{sub}</div>
    </div>
  )
}

function FactorRadar({ stock, labels }) {
  const fs = stock.factor_scores || {}
  const data = {
    labels: FACTOR_ORDER.map((f) => labels[f]),
    datasets: [
      { label: stock.ticker, data: FACTOR_ORDER.map((f) => fs[f] ?? null), borderColor: '#3987e5', backgroundColor: '#3987e533',
        borderWidth: 2, pointRadius: 4, pointBackgroundColor: '#3987e5', pointBorderColor: '#111827', pointBorderWidth: 2 },
      { label: '바스켓 평균 (3.0)', data: FACTOR_ORDER.map(() => 3), borderColor: '#6b7280', borderDash: [4, 4],
        borderWidth: 1.5, pointRadius: 0, fill: false },
    ],
  }
  const options = {
    maintainAspectRatio: false,
    scales: { r: { min: 1, max: 5, ticks: { stepSize: 1, backdropColor: 'transparent', color: '#6b7280' },
      grid: { color: '#1f2937' }, angleLines: { color: '#1f2937' }, pointLabels: { color: '#d1d5db', font: { size: 12 } } } },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, color: '#9ca3af' } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.n(c.raw)}점` } },
    },
  }
  return <div className="h-80"><Radar data={data} options={options} /></div>
}

// 12-1M 구간 음영 + 52주 고점선
const bandPlugin = {
  id: 'momentumBand',
  beforeDatasetsDraw(chart, _a, opts) {
    const { ctx, chartArea, scales: { x } } = chart
    const labels = chart.data.labels
    const i0 = labels.indexOf(opts.start)
    const i1 = labels.indexOf(opts.end)
    if (i0 < 0 && i1 < 0) return
    const x0 = i0 >= 0 ? x.getPixelForValue(i0) : chartArea.left
    const x1 = i1 >= 0 ? x.getPixelForValue(i1) : chartArea.right
    ctx.save()
    ctx.fillStyle = 'rgba(57,135,229,0.07)'
    ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top)
    ctx.fillStyle = '#6b7280'
    ctx.font = '11px Inter, sans-serif'
    ctx.fillText('12-1M 모멘텀 구간', x0 + 6, chartArea.top + 14)
    ctx.restore()
  },
}

function PriceChart({ stock }) {
  const ch = stock.chart
  if (!ch) return <div className="py-16 text-center text-sm text-gray-500">가격 데이터 없음</div>
  const cur = stock.currency
  const data = {
    labels: ch.d,
    datasets: [
      { label: '종가', data: ch.c, borderColor: '#e5e7eb', borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.1 },
      { label: '200일 이동평균', data: ch.ma200, borderColor: '#d95926', borderWidth: 2, borderDash: [6, 4], pointRadius: 0, spanGaps: true },
      { label: '52주 고점', data: ch.d.map(() => stock.high52), borderColor: '#199e70', borderWidth: 1.5, borderDash: [2, 3], pointRadius: 0 },
    ],
  }
  const options = {
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: { ticks: { maxTicksLimit: 7, color: '#6b7280' }, grid: { display: false } },
      y: { ticks: { color: '#6b7280', callback: (v) => fmt.price(v, cur) }, grid: { color: '#1f293766' } },
    },
    plugins: {
      legend: { position: 'bottom', labels: { boxWidth: 12, color: '#9ca3af' } },
      tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt.price(c.raw, cur)}` } },
      momentumBand: { start: ch.m_start, end: ch.m_end },
    },
  }
  return <div className="h-80"><Line data={data} options={options} plugins={[bandPlugin]} /></div>
}

const LEVEL_STYLE = {
  danger: { icon: ShieldAlert, cls: 'border-red-900/70 bg-red-950/30', ic: 'text-red-400' },
  warn: { icon: AlertTriangle, cls: 'border-amber-900/70 bg-amber-950/25', ic: 'text-amber-400' },
  info: { icon: Info, cls: 'border-gray-700 bg-gray-900', ic: 'text-gray-400' },
}

function RiskCards({ stock }) {
  const flags = stock.flags || []
  if (!flags.length) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-4 text-sm text-emerald-200">
        <CheckCircle2 size={18} /> 활성화된 위험 경고가 없습니다 (가치 함정 · 모멘텀 크러시 · 테마 과열 · 부실 · 저유동성).
      </div>
    )
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {flags.map((f) => {
        const s = LEVEL_STYLE[f.level] || LEVEL_STYLE.info
        const Icon = s.icon
        return (
          <div key={f.key} className={`rounded-xl border p-4 ${s.cls}`}>
            <div className="flex items-center gap-2 font-medium text-gray-100"><Icon size={18} className={s.ic} /> {f.title}</div>
            <div className="mt-1 text-sm text-gray-300">{f.detail}</div>
          </div>
        )
      })}
    </div>
  )
}

function FactorTable({ stock, labels }) {
  const mz = stock.metric_z || {}
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="py-2 pr-3 font-normal">팩터 / 지표</th>
            <th className="py-2 pr-3 text-right font-normal">원값</th>
            <th className="py-2 pr-3 text-right font-normal">Z</th>
            <th className="py-2 font-normal">바스켓 내 위치</th>
          </tr>
        </thead>
        <tbody>
          {FACTOR_ORDER.map((f) => (
            [
              <tr key={f} className="border-b border-gray-800/60 bg-gray-900/40">
                <td className="py-2 pr-3 font-medium text-gray-200">{labels[f]} <InfoTip k={FACTOR_TIP[f] || f} /></td>
                <td />
                <td className={`num py-2 pr-3 text-right font-medium ${scoreTone(stock.factor_scores?.[f])}`}>
                  {fmt.n(stock.factor_scores?.[f], 1)}점
                </td>
                <td />
              </tr>,
              ...FACTOR_METRICS[f].map((m) => {
                const [lab, kind] = METRIC_LABEL[m]
                const z = mz[m]
                const neg = ['accruals', 'debt_to_equity'].includes(m)
                const good = isNumber(z) ? (neg ? -z : z) : null
                return (
                  <tr key={m} className="border-b border-gray-800/40">
                    <td className="py-1.5 pl-4 pr-3 text-gray-400">{lab}{METRIC_TIP[m] && <InfoTip k={METRIC_TIP[m]} className="ml-1" />}</td>
                    <td className="num py-1.5 pr-3 text-right text-gray-300">{fmtMetric(stock[m], kind)}</td>
                    <td className="num py-1.5 pr-3 text-right text-gray-400">{isNumber(z) ? z.toFixed(2) : '–'}</td>
                    <td className="py-1.5">
                      <div className="relative h-2 w-32 rounded-full bg-gray-800">
                        <div className="absolute left-1/2 top-0 h-2 w-px bg-gray-600" />
                        {isNumber(good) && (
                          <div className="absolute top-0 h-2 rounded-full"
                            style={{
                              left: good >= 0 ? '50%' : `${50 + Math.max(good, -3) / 6 * 100}%`,
                              width: `${Math.min(Math.abs(good), 3) / 6 * 100}%`,
                              background: good >= 0 ? '#199e70' : '#d95926',
                            }} />
                        )}
                      </div>
                    </td>
                  </tr>
                )
              }),
            ]
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-gray-600">막대: 좋은 방향 기준 Z (−3~+3). 결측 지표는 팩터 평균에서 제외(중립).</p>
    </div>
  )
}

function Checklist({ stock }) {
  const checks = stock.fscore_checks || {}
  const parts = stock.altman_parts || {}
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div>
        <div className="mb-2 text-sm font-medium text-gray-200">
          Piotroski F-Score <InfoTip k="fscore" /> <span className="num text-gray-400">{stock.fscore ?? '–'}/9</span>
          {stock.fscore_available < 9 && <span className="ml-2 text-xs text-gray-500">({stock.fscore_available}개 기준 채점 후 9점 환산)</span>}
        </div>
        <ul className="space-y-1 text-sm">
          {Object.entries(checks).map(([k, v]) => (
            <li key={k} className="flex items-center gap-2 text-gray-300">
              {v === true ? <CheckCircle2 size={15} className="text-emerald-400" />
                : v === false ? <XCircle size={15} className="text-red-400" />
                  : <MinusCircle size={15} className="text-gray-600" />}
              <span className={v == null ? 'text-gray-600' : ''}>{k}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="mb-2 text-sm font-medium text-gray-200">
          Altman Z-Score <InfoTip k="altman" /> <span className="num text-gray-400">{fmt.n(stock.altman_z)}</span>
          {stock.altman_note && <span className="ml-2 text-xs text-gray-500">{stock.altman_note}</span>}
        </div>
        <div className="mb-2 font-mono text-[11px] text-gray-500">Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 0.999·X5</div>
        <ul className="space-y-1 text-sm">
          {Object.entries(parts).map(([k, v]) => (
            <li key={k} className="flex justify-between text-gray-300"><span className="text-gray-400">{k}</span><span className="num">{fmt.n(v, 3)}</span></li>
          ))}
        </ul>
        <div className="mt-3 flex h-2 overflow-hidden rounded-full">
          <div className="flex-[181] bg-red-900/70" title="부실 < 1.81" />
          <div className="flex-[118] bg-amber-900/60" title="회색 1.81~2.99" />
          <div className="flex-[200] bg-emerald-900/60" title="안전 ≥ 2.99" />
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-500"><span>0 부실</span><span>1.81</span><span>2.99 안전</span><span>5+</span></div>
      </div>
    </div>
  )
}

export default function StockView({ stock, data, busy }) {
  const cfg = data.config
  const labels = cfg.factor_labels
  const up = (stock.change_pct ?? 0) >= 0
  const cur = stock.currency
  return (
    <div className={`space-y-4 transition ${busy ? 'opacity-60' : ''}`}>
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span className="font-mono">{stock.ticker}</span> · {stock.sector} · {stock.industry}
              {stock._extra && !stock._live && <span className="rounded bg-gray-800 px-1.5 text-gray-300">추가 종목 · 바스켓 기준 채점</span>}
              {stock._live && <span className="rounded bg-sky-950 px-1.5 text-sky-300">{stock._inUniverse ? '실시간 재채점' : '유니버스 외 · 바스켓 기준 채점'}</span>}
            </div>
            <h1 className="mt-1 text-2xl font-semibold text-white">{stock.name}</h1>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="num text-3xl font-semibold text-white">{fmt.price(stock.price, cur)}</span>
              <span className={`num text-sm font-medium ${up ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.pct(stock.change_pct, 2)}</span>
              <span className="hidden text-xs text-gray-500 sm:inline">{stock.as_of} · 시총 {fmt.big(stock.market_cap, cur)}</span>
            </div>
          </div>
          <TierBadge tier={stock.tier} tiers={cfg.tiers} />
        </div>
        {stock.single_condition && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs text-gray-300">
            <Zap size={14} className="text-amber-400" />
            한 가지 조건만 충족 ({stock.tier === 2 ? '펀더멘털 O · 추세 X' : '추세 O · 펀더멘털 X'}) — 원칙상 신규 매수 금지, {cfg.tiers[stock.tier].action}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="종합 점수 (펀더멘털)" value={fmt.n(stock.composite_score, 2)} tone={scoreTone(stock.composite_score)}
          sub={`바스켓 상위 ${isNumber(stock.composite_pct) ? Math.max(1, Math.round((1 - stock.composite_pct) * 100) || 1) : '–'}% · 기준 ≥ ${cfg.thresholds.tier_composite}`}
          tip="composite" />
        <MetricCard label="모멘텀 점수" value={fmt.n(stock.momentum_score, 2)} tone={scoreTone(stock.momentum_score)}
          sub={`12-1M ${fmt.pct(stock.ret_12_1, 0)} · 고점비 ${fmt.pctPlain(stock.high52_ratio)}`}
          tip="momentum" />
        <MetricCard label="Piotroski F-Score" tip="fscore" value={`${stock.fscore ?? '–'}`}
          tone={stock.fscore >= cfg.thresholds.fscore_strong ? 'text-emerald-400' : stock.fscore < 4 ? 'text-red-400' : 'text-gray-200'}
          sub={stock.fscore >= cfg.thresholds.fscore_strong ? '우량 (7점 이상)' : stock.fscore < 4 ? '취약 (4점 미만)' : '보통'} />
        <MetricCard label="Altman Z-Score" tip="altman" value={fmt.n(stock.altman_z, 2)}
          tone={!isNumber(stock.altman_z) ? 'text-gray-500' : stock.altman_z < cfg.thresholds.altman_distress ? 'text-red-400'
            : stock.altman_z < cfg.thresholds.altman_safe ? 'text-amber-400' : 'text-emerald-400'}
          sub={!isNumber(stock.altman_z) ? (stock.altman_note || '–') : stock.altman_z < 1.81 ? '부실 위험 구간' : stock.altman_z < 2.99 ? '회색 지대' : '안전 구간'} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-gray-300">위험 필터 · 함정 경고 <InfoTip k="risk" /></h2>
        <RiskCards stock={stock} />
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <div className="panel min-w-0 p-4 lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-gray-300">6-팩터 점수 분포 <InfoTip k="factors" /></h2>
          <FactorRadar stock={stock} labels={labels} />
        </div>
        <div className="panel min-w-0 p-4 lg:col-span-3">
          <h2 className="mb-2 text-sm font-medium text-gray-300">가격 · 200일선 · 52주 고점</h2>
          <PriceChart stock={stock} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-5">
        <div className="panel min-w-0 p-4 lg:col-span-3">
          <h2 className="mb-3 text-sm font-medium text-gray-300">팩터 분해 (Z-Score) <InfoTip k="zscore" /></h2>
          <FactorTable stock={stock} labels={labels} />
        </div>
        <div className="panel min-w-0 space-y-4 p-4 lg:col-span-2">
          <h2 className="text-sm font-medium text-gray-300">재무 건전성 체크리스트</h2>
          <Checklist stock={stock} />
          <div className="grid grid-cols-2 gap-2 border-t border-gray-800 pt-3 text-xs">
            {[
              ['PER', fmt.n(stock.pe, 1)], ['PBR', fmt.n(stock.pb, 2)],
              ['EPS 서프라이즈(4Q 평균)', fmt.pct(stock.eps_surprise)], ['다음해 EPS 성장(컨센서스)', fmt.pct(stock.fwd_eps_growth)],
              ['3개월 최대낙폭', fmt.pct(stock.drawdown_3m)], ['20일 평균 거래대금', fmt.big(stock.avg_traded_value, cur)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2"><span className="text-gray-500">{k}</span><span className="num text-gray-300">{v}</span></div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
