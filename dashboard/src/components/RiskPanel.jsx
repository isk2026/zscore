import { useEffect, useMemo, useState } from 'react'
import { Activity } from 'lucide-react'
import InfoTip from './InfoTip.jsx'
import { fmt } from '../lib.js'

const isKR = (t, s) => (s?.market ? s.market === 'KR' : /\.(KS|KQ)$/.test(t))

// ── 계산 ───────────────────────────────────────────────────────────────────
function column(arr) {
  const v = arr.filter((x) => x != null)
  const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
  return arr.map((x) => (x == null ? m : x)) // 결측은 평균으로 (공분산에 영향 최소)
}
function cov(a, b) {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n
  let s = 0
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb)
  return s / (n - 1)
}

function clusterByCorr(names, corr, th) {
  let groups = names.map((_, i) => [i])
  const avg = (g, h) => { let s = 0; for (const i of g) for (const j of h) s += corr[i][j]; return s / (g.length * h.length) }
  for (;;) {
    let best = null
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      const c = avg(groups[a], groups[b])
      if (c >= th && (!best || c > best.c)) best = { a, b, c }
    }
    if (!best) break
    const merged = [...groups[best.a], ...groups[best.b]]
    groups = groups.filter((_, k) => k !== best.a && k !== best.b).concat([merged])
  }
  return groups.map((g) => {
    let s = 0, n = 0
    for (const i of g) for (const j of g) if (i < j) { s += corr[i][j]; n++ }
    return { idx: g, avgCorr: n ? s / n : null }
  })
}

export function analyze(rows, risk, krw) {
  const fx = risk.fx ? column(risk.fx) : null
  const held = rows.filter((r) => r.w > 0)
  const ok = held.filter((r) => risk.ret[r.ticker])
  const missing = held.filter((r) => !risk.ret[r.ticker])
  if (!ok.length) return { missing, n: 0 }
  const usd = ok.filter((r) => !isKR(r.ticker, r.s))
  const series = ok.map((r) => {
    const x = column(risk.ret[r.ticker])
    return krw && fx && !isKR(r.ticker, r.s) ? x.map((v, t) => (1 + v) * (1 + fx[t]) - 1) : x
  })
  const w = ok.map((r) => r.w)
  const n = ok.length, T = series[0].length
  const S = series.map((a) => series.map((b) => cov(a, b)))
  const Sw = S.map((row) => row.reduce((a, v, j) => a + v * w[j], 0))
  const varP = w.reduce((a, wi, i) => a + wi * Sw[i], 0)
  const rc = w.map((wi, i) => (varP > 0 ? (wi * Sw[i]) / varP : 0))
  const effBets = 1 / rc.reduce((a, x) => a + Math.max(0, x) ** 2, 0)
  const sd = S.map((row, i) => Math.sqrt(row[i]))
  const corr = S.map((row, i) => row.map((v, j) => (sd[i] && sd[j] ? v / (sd[i] * sd[j]) : 0)))
  const port = Array.from({ length: T }, (_, t) => series.reduce((a, s, i) => a + s[t] * w[i], 0))
  const beta = {}
  for (const [m, xs] of Object.entries(risk.index)) {
    const ix = column(xs)
    const v = cov(ix, ix)
    beta[m] = v > 0 ? cov(port, ix) / v : null
  }
  let nav = 1, peak = 1, mdd = 0
  for (const r of port) { nav *= 1 + r; peak = Math.max(peak, nav); mdd = Math.min(mdd, nav / peak - 1) }

  const groups = clusterByCorr(ok.map((r) => r.ticker), corr, risk.config.corr_cluster)
    .map((g) => ({ ...g, w: g.idx.reduce((a, i) => a + w[i], 0), rc: g.idx.reduce((a, i) => a + rc[i], 0) }))
    .sort((a, b) => b.rc - a.rc)

  const stress = risk.stress.map((s) => {
    let p = 0
    const sub = []
    ok.concat(missing).forEach((r) => {
      const kr = isKR(r.ticker, r.s)
      let x = s.ret[r.ticker]
      if (x == null) { x = s.index[kr ? 'KR' : 'US']; sub.push(r.ticker) }
      if (x == null) return
      if (krw && !kr && s.fx != null) x = (1 + x) * (1 + s.fx) - 1
      p += r.w * x
    })
    return { ...s, port: p, sub }
  })

  return {
    n, ok, missing, w, rc, corr, groups, beta, stress, effBets,
    vol: Math.sqrt(varP * 52), mdd,
    usdShare: usd.reduce((a, r) => a + r.w, 0), invested: held.reduce((a, r) => a + r.w, 0),
  }
}

// ── 화면 ───────────────────────────────────────────────────────────────────
function Card({ label, value, sub, tip, tone = 'text-white' }) {
  return (
    <div className="rounded-xl bg-gray-900 p-3">
      <div className="flex items-center gap-1 text-[11px] text-gray-500">{label}{tip && <InfoTip k={tip} />}</div>
      <div className={`num mt-0.5 text-xl font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500">{sub}</div>}
    </div>
  )
}

// 상관 색: 음(파랑) ← 0(회색) → 양(주황). 발산형 두 색 + 중립 회색
function corrColor(c) {
  const t = Math.min(1, Math.abs(c))
  const [r0, g0, b0] = [55, 65, 81]
  const [r1, g1, b1] = c >= 0 ? [217, 89, 38] : [57, 135, 229]
  const m = (a, b) => Math.round(a + (b - a) * t)
  return `rgb(${m(r0, r1)},${m(g0, g1)},${m(b0, b1)})`
}

function Heatmap({ a, label }) {
  const order = a.groups.flatMap((g) => g.idx)
  const n = order.length
  if (n < 2) return null
  const cell = n > 16 ? 14 : 20
  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-px" style={{ gridTemplateColumns: `96px repeat(${n}, ${cell}px)` }}>
        {order.map((i) => (
          <div key={`r${i}`} className="contents">
            <div className="truncate pr-2 text-right text-[10px] leading-none text-gray-400" style={{ lineHeight: `${cell}px` }}>{label(i)}</div>
            {order.map((j) => (
              <div key={j} title={`${label(i)} × ${label(j)}: ${a.corr[i][j].toFixed(2)}`}
                style={{ width: cell, height: cell, background: i === j ? '#111827' : corrColor(a.corr[i][j]) }} />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500">
        <span>−1</span>
        <div className="h-2 w-32 rounded" style={{ background: `linear-gradient(90deg, ${corrColor(-1)}, ${corrColor(0)}, ${corrColor(1)})` }} />
        <span>+1</span><span className="ml-2">주간 수익률 상관 · 같은 베팅 묶음 순서로 정렬</span>
      </div>
    </div>
  )
}

export default function RiskPanel({ rows }) {
  const [risk, setRisk] = useState(undefined)
  const [krw, setKrw] = useState(true)
  useEffect(() => {
    fetch(`./data/risk.json?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).then(setRisk).catch(() => setRisk(null))
  }, [])
  const a = useMemo(() => (risk ? analyze(rows, risk, krw) : null), [rows, risk, krw])
  if (risk === undefined) return null
  if (!risk || !a) return null
  const name = (i) => a.ok[i].s?.name || a.ok[i].ticker
  const bets = a.groups.filter((g) => g.idx.length >= 2)
  const top = a.ok.map((r, i) => ({ i, w: a.w[i], rc: a.rc[i] })).sort((x, y) => y.rc - x.rc).slice(0, 10)
  const maxBar = Math.max(...top.map((t) => Math.max(t.w / a.invested, t.rc)), 0.01)

  return (
    <section className="panel min-w-0 space-y-5 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Activity size={18} className="text-sky-400" />
        <h2 className="text-sm font-medium text-gray-200">포트폴리오 위험 — 실제 움직임 기준</h2>
        <span className="text-[11px] text-gray-500">주간 수익률 {risk.weeks.length}주 · {risk.as_of}</span>
        <div className="ml-auto flex rounded-lg border border-gray-800 p-0.5">
          {[[true, '원화 기준'], [false, '현지통화']].map(([v, l]) => (
            <button key={l} onClick={() => setKrw(v)} className={`rounded-md px-3 py-1 text-xs ${krw === v ? 'bg-gray-700 text-white' : 'text-gray-400'}`}>{l}</button>
          ))}
        </div>
      </div>

      {a.n === 0 ? <p className="text-xs text-gray-500">보유 종목을 입력하면 계산합니다.</p> : <>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Card label="예상 연 변동성" tip="risk_vol" value={fmt.pctPlain(a.vol, 1)} sub={`2년 주간 최대 낙폭 ${fmt.pct(a.mdd)}`} />
          <Card label="S&P500 베타" tip="risk_beta" value={fmt.n(a.beta.US)} sub="지수 1% → 포트폴리오" />
          <Card label="KOSPI 베타" value={fmt.n(a.beta.KR)} sub="지수 1% → 포트폴리오" />
          <Card label="유효 베팅 수" tip="eff_bets" value={a.effBets.toFixed(1)} sub={`보유 ${a.n}종목 · 같은 베팅 묶음 ${bets.length}개`}
            tone={a.effBets < a.n / 3 ? 'text-amber-300' : 'text-white'} />
          <Card label="달러 자산 노출" tip="fx_exposure" value={fmt.pctPlain(a.usdShare / (a.invested || 1))} sub={`투자분 기준 · 전체의 ${fmt.pctPlain(a.usdShare)}`} />
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1 text-xs font-medium text-gray-300">숨은 집중 — 업종과 상관없이 같이 움직이는 묶음 <InfoTip k="hidden_conc" /></h3>
          {bets.length === 0 ? <p className="text-xs text-gray-500">평균 상관 {risk.config.corr_cluster} 이상으로 묶이는 종목이 없습니다.</p> : (
            <div className="space-y-1.5">
              {bets.map((g) => (
                <div key={g.idx.join()} className="rounded-lg bg-gray-900 px-3 py-2 text-xs">
                  <div className="text-gray-200">{g.idx.map(name).join(' · ')}</div>
                  <div className="mt-0.5 text-gray-500">
                    평균 상관 {g.avgCorr.toFixed(2)} · 비중 {fmt.pctPlain(g.w, 1)} · <span className={g.rc > g.w / a.invested + 0.05 ? 'text-amber-300' : ''}>위험 기여 {fmt.pctPlain(g.rc)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <h3 className="mb-2 text-xs font-medium text-gray-300">종목별 비중 vs 위험 기여 (상위 10)</h3>
            <div className="space-y-1.5">
              {top.map((t) => (
                <div key={t.i} className="grid grid-cols-[minmax(0,7rem)_1fr_3rem] items-center gap-2 text-xs">
                  <span className="truncate text-gray-300">{name(t.i)}</span>
                  <div className="space-y-0.5">
                    <div className="h-1.5 rounded-sm bg-gray-500" style={{ width: `${(t.w / a.invested / maxBar) * 100}%` }} title={`투자분 중 비중 ${fmt.pctPlain(t.w / a.invested, 1)}`} />
                    <div className="h-1.5 rounded-sm bg-[#d95926]" style={{ width: `${(Math.max(0, t.rc) / maxBar) * 100}%` }} title={`위험 기여 ${fmt.pctPlain(t.rc, 1)}`} />
                  </div>
                  <span className="num text-right text-gray-300">{fmt.pctPlain(t.rc)}</span>
                </div>
              ))}
              <div className="flex gap-3 pt-1 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-gray-500" />투자분 중 비중</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-3 rounded-sm bg-[#d95926]" />위험 기여 (숫자)</span>
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="mb-2 text-xs font-medium text-gray-300">상관 지도</h3>
            <Heatmap a={a} label={name} />
          </div>
        </div>

        <div>
          <h3 className="mb-2 flex items-center gap-1 text-xs font-medium text-gray-300">과거 하락 구간 재현 <InfoTip k="stress" /></h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-left text-xs whitespace-nowrap text-gray-500">
                  <th className="py-1.5 pr-2 font-normal">구간</th>
                  <th className="py-1.5 pr-2 text-right font-normal">포트폴리오</th>
                  <th className="py-1.5 pr-2 text-right font-normal">S&P500</th>
                  <th className="py-1.5 pr-2 text-right font-normal">KOSPI</th>
                  <th className="py-1.5 text-right font-normal">원/달러</th>
                </tr>
              </thead>
              <tbody>
                {a.stress.map((s) => (
                  <tr key={s.name} className="border-b border-gray-800/50">
                    <td className="py-1.5 pr-2">
                      <div className="text-gray-200">{s.name}</div>
                      <div className="text-[10px] text-gray-500">{s.start} ~ {s.end}{s.sub.length ? ` · ${s.sub.length}종목은 지수로 대체(당시 미상장 등)` : ''}</div>
                    </td>
                    {[s.port, s.index.US, s.index.KR, s.fx].map((v, k) => (
                      <td key={k} className={`num py-1.5 pr-2 text-right ${k === 0 ? 'font-semibold' : ''} ${v == null ? 'text-gray-600' : v >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmt.pct(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-gray-600">
            지금 비중을 그 구간에 그대로 들고 있었다면의 수익 (현금 0%). {krw ? '원화 기준: 미국 종목은 원/달러 변동을 곱함 — 하락장에서 달러 강세가 손실을 줄이는 효과가 반영됩니다.' : '현지통화 기준 (환율 효과 제외).'}
            {a.missing.length > 0 && ` · 위험 데이터 없는 종목 ${a.missing.length}개는 변동성·상관 계산에서 제외.`}
          </p>
        </div>
      </>}
    </section>
  )
}
