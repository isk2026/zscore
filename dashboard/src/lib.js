export const TIER_COLOR = { 1: '#199e70', 2: '#3987e5', 3: '#d95926', 4: '#6b7280' }
export const TIER_SHAPE = { 1: 'star', 2: 'rectRot', 3: 'triangle', 4: 'circle' }

export const FLAG_META = {
  value_trap: { label: '가치 함정', level: 'warn' },
  momentum_crash: { label: '모멘텀 크러시', level: 'danger' },
  theme_hype: { label: '테마 과열', level: 'danger' },
  bankruptcy: { label: '부실 위험', level: 'danger' },
  grey_zone: { label: 'Altman 회색', level: 'info' },
  low_liquidity: { label: '저유동성', level: 'warn' },
  below_ma200: { label: '200일선 이탈', level: 'warn' },
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

export const fmt = {
  n: (x, d = 2) => (isNum(x) ? x.toFixed(d) : '–'),
  pct: (x, d = 1) => (isNum(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '–'),
  pctPlain: (x, d = 0) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '–'),
  price: (x, cur) => {
    if (!isNum(x)) return '–'
    return cur === 'KRW' ? `₩${Math.round(x).toLocaleString()}` : `$${x.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  },
  big: (x, cur) => {
    if (!isNum(x)) return '–'
    if (cur === 'KRW') {
      if (Math.abs(x) >= 1e12) return `${(x / 1e12).toFixed(1)}조원`
      return `${(x / 1e8).toFixed(0)}억원`
    }
    if (Math.abs(x) >= 1e12) return `$${(x / 1e12).toFixed(2)}T`
    if (Math.abs(x) >= 1e9) return `$${(x / 1e9).toFixed(1)}B`
    return `$${(x / 1e6).toFixed(0)}M`
  },
}

export const isNumber = isNum

export function scoreTone(s) {
  if (!isNum(s)) return 'text-gray-500'
  if (s >= 3.5) return 'text-emerald-400'
  if (s >= 3.0) return 'text-sky-400'
  if (s >= 2.5) return 'text-gray-300'
  return 'text-orange-400'
}

export const LS = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key)
      return v == null ? fallback : JSON.parse(v)
    } catch { return fallback }
  },
  set(key, v) {
    try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* 사설 모드 등 */ }
  },
}

// 데이터 갱신·종목 추가는 GitHub Actions 가 한다. 공개 페이지에 쓰기 토큰을 넣을 수 없으므로
// 실행 페이지로 연결한다 (저장소 주인만 'Run workflow' 가능) — Beta Model 과 같은 방식.
export const REPO = 'isk2026/zscore'
export const RUN_URL = `https://github.com/${REPO}/actions/workflows/update.yml`
