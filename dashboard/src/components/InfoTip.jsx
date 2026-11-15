import { useEffect, useRef, useState } from 'react'
import { Info } from 'lucide-react'
import { GLOSSARY } from '../glossary.js'

// 마우스를 올리면(PC) / 탭하면(휴대폰) 설명 카드. 화면 밖으로 나가지 않게 fixed 위치를 계산한다.
export default function InfoTip({ k, size = 13, className = '' }) {
  const g = GLOSSARY[k]
  const btn = useRef(null)
  const [pos, setPos] = useState(null)
  const [pinned, setPinned] = useState(false)

  const show = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const W = Math.min(320, window.innerWidth - 16)
    const left = Math.min(Math.max(8, r.left + r.width / 2 - W / 2), window.innerWidth - W - 8)
    const below = r.bottom + 8
    const flip = below + 260 > window.innerHeight && r.top > 280
    setPos({ left, width: W, ...(flip ? { bottom: window.innerHeight - r.top + 8 } : { top: below }) })
  }
  const hide = () => { if (!pinned) setPos(null) }

  useEffect(() => {
    if (!pos) return undefined
    const close = (e) => { if (!btn.current?.contains(e.target)) { setPinned(false); setPos(null) } }
    const onScroll = () => { setPinned(false); setPos(null) }
    document.addEventListener('pointerdown', close)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { document.removeEventListener('pointerdown', close); window.removeEventListener('scroll', onScroll) }
  }, [pos])

  if (!g) return null
  return (
    <span className={`inline-flex align-middle ${className}`}>
      <button
        ref={btn} type="button" aria-label={`${g.title} 설명`} aria-expanded={!!pos}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={() => { setPinned(false); setPos(null) }}
        onClick={(e) => { e.stopPropagation(); if (pinned) { setPinned(false); setPos(null) } else { setPinned(true); show() } }}
        className="-m-1.5 rounded-full p-2 text-gray-500 hover:text-sky-300 focus:text-sky-300 focus:outline-none"
      >
        <Info size={size} />
      </button>
      {pos && (
        <span role="tooltip" style={{ position: 'fixed', ...pos }}
          className="z-50 block rounded-xl border border-gray-700 bg-gray-950/95 p-3 text-left text-xs font-normal normal-case leading-relaxed text-gray-300 shadow-2xl backdrop-blur">
          <span className="mb-1 block text-sm font-semibold text-white">{g.title}</span>
          {g.body && <span className="block">{g.body}</span>}
          {g.formula && <span className="mt-2 block whitespace-pre-line rounded-lg bg-gray-900 px-2 py-1.5 font-mono text-[11px] text-sky-200">{g.formula}</span>}
          {g.read && <span className="mt-2 block text-gray-400">{g.read}</span>}
        </span>
      )}
    </span>
  )
}
