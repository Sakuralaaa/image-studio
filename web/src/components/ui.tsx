import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Minus, Plus, X } from 'lucide-react'

// ---------- 下拉选择 ----------
export interface Opt { value: string; label: string; hint?: string }
export function Select({ value, options, onChange, placeholder = '请选择', disabled, className = '' }: {
  value: string; options: Opt[]; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null)
  const cur = options.find(o => o.value === value)
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const h = Math.min(320, options.length * 40 + 12)
    const up = r.bottom + h + 8 > window.innerHeight && r.top > h
    setPos({ left: r.left, top: up ? r.top - h - 6 : r.bottom + 6, width: r.width, up })
  }, [open, options.length])
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || (t as HTMLElement).closest?.('.menu-pop')) return
      setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('scroll', close, true); window.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} className={`select ${open ? 'is-open' : ''} ${disabled ? 'is-disabled' : ''} ${className}`}>
      <button type="button" className="select-btn" disabled={disabled} onClick={() => setOpen(o => !o)}>
        <span className={`select-val ${cur ? '' : 'is-ph'}`}>{cur ? cur.label : placeholder}</span>
        <ChevronDown size={15} className="select-caret" />
      </button>
      {open && pos && createPortal(
        <div className={`menu-pop ${pos.up ? 'up' : ''}`} style={{ left: pos.left, top: pos.top, minWidth: pos.width }}>
          {options.length === 0 && <div className="menu-empty">暂无选项</div>}
          {options.map(o => (
            <button key={o.value} type="button" className={`menu-item ${o.value === value ? 'is-on' : ''}`} onClick={() => { onChange(o.value); setOpen(false) }}>
              <span className="menu-label">{o.label}</span>
              {o.hint && <span className="menu-hint">{o.hint}</span>}
              {o.value === value && <Check size={14} className="menu-check" />}
            </button>
          ))}
        </div>, document.body)}
    </div>
  )
}

// ---------- 分段控件 ----------
export function Segmented({ value, options, onChange, disabled, size = 'md', wrap }: {
  value: string; options: Opt[]; onChange: (v: string) => void; disabled?: boolean; size?: 'sm' | 'md'; wrap?: boolean
}) {
  return (
    <div className={`seg seg-${size} ${disabled ? 'is-disabled' : ''} ${wrap ? 'seg-wrap' : ''}`} role="radiogroup">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={disabled}
          className={`seg-item ${o.value === value ? 'is-on' : ''}`} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

// ---------- 步进器 ----------
export function Stepper({ value, min = 1, max = 10, onChange, disabled }: { value: number; min?: number; max?: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <div className={`stepper ${disabled ? 'is-disabled' : ''}`}>
      <button type="button" disabled={disabled || value <= min} onClick={() => onChange(Math.max(min, value - 1))} aria-label="减少"><Minus size={14} /></button>
      <span className="stepper-val">{value}</span>
      <button type="button" disabled={disabled || value >= max} onClick={() => onChange(Math.min(max, value + 1))} aria-label="增加"><Plus size={14} /></button>
    </div>
  )
}

// ---------- 开关 ----------
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} className={`switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}><span /></button>
}

// ---------- 弹窗 ----------
export function Modal({ open, onClose, title, children, footer, wide, className = '' }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean; className?: string
}) {
  useEffect(() => {
    if (!open) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    document.body.classList.add('no-scroll')
    return () => { window.removeEventListener('keydown', esc); document.body.classList.remove('no-scroll') }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <div className="modal-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>, document.body)
}

// ---------- 标签输入 ----------
export function TagInput({ value, onChange, placeholder = '输入后回车' }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const parts = draft.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean)
    if (parts.length) onChange([...value, ...parts.filter(p => !value.includes(p))])
    setDraft('')
  }
  return (
    <div className="taginput">
      {value.map(t => (
        <span key={t} className="tag">{t}<button type="button" onClick={() => onChange(value.filter(x => x !== t))} aria-label="移除"><X size={12} /></button></span>
      ))}
      <input value={draft} placeholder={value.length ? '' : placeholder} onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); commit() }
          else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
        }} onBlur={commit} />
    </div>
  )
}

// ---------- 瀑布流 ----------
export function Masonry<T>({ items, aspect, render, minCol = 240, gap = 14, keyOf }: {
  items: T[]; aspect: (t: T) => number; render: (t: T) => ReactNode; minCol?: number; gap?: number; keyOf: (t: T) => string | number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const calc = () => {
      const w = el.clientWidth
      const g = w < 520 ? 10 : gap
      setCols(Math.max(2, Math.floor((w + g) / (minCol + g))))
    }
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [minCol, gap])
  const columns: T[][] = Array.from({ length: cols || 1 }, () => [])
  const heights = new Array(cols || 1).fill(0)
  for (const it of items) {
    let k = 0
    for (let i = 1; i < heights.length; i++) if (heights[i] < heights[k] - 0.02) k = i
    columns[k].push(it)
    heights[k] += 1 / Math.max(0.2, aspect(it)) + 0.04
  }
  return (
    <div ref={ref} className="masonry" style={{ ['--gap' as any]: `${gap}px` }}>
      {cols > 0 && columns.map((c, i) => (
        <div className="masonry-col" key={i}>{c.map(it => <div className="masonry-cell" key={keyOf(it)}>{render(it)}</div>)}</div>
      ))}
    </div>
  )
}

// ---------- 空状态 ----------
export function Empty({ title, text, art = 'frame', action }: { title: string; text?: string; art?: 'frame' | 'book' | 'stack' | 'plug'; action?: ReactNode }) {
  return (
    <div className="empty">
      <EmptyArt kind={art} />
      <div className="empty-title">{title}</div>
      {text && <div className="empty-text">{text}</div>}
      {action}
    </div>
  )
}

function EmptyArt({ kind }: { kind: string }) {
  if (kind === 'book') return (
    <svg className="empty-art" viewBox="0 0 120 90" fill="none">
      <path d="M14 18c14-6 30-6 46 4v56c-16-10-32-10-46-4V18Z" className="ea-fill" />
      <path d="M106 18c-14-6-30-6-46 4v56c16-10 32-10 46-4V18Z" className="ea-fill2" />
      <path d="M24 32h24M24 42h20M72 32h24M72 42h18M72 52h22" className="ea-line" />
      <circle cx="96" cy="16" r="5" className="ea-dot" />
    </svg>
  )
  if (kind === 'stack') return (
    <svg className="empty-art" viewBox="0 0 120 90" fill="none">
      <rect x="30" y="14" width="56" height="44" rx="6" transform="rotate(-8 58 36)" className="ea-fill2" />
      <rect x="34" y="22" width="56" height="44" rx="6" transform="rotate(5 62 44)" className="ea-fill" />
      <path d="M44 56l12-14 9 10 6-6 12 12" className="ea-line" />
      <circle cx="74" cy="36" r="4" className="ea-dot" />
    </svg>
  )
  if (kind === 'plug') return (
    <svg className="empty-art" viewBox="0 0 120 90" fill="none">
      <rect x="20" y="30" width="34" height="30" rx="8" className="ea-fill" />
      <rect x="66" y="30" width="34" height="30" rx="8" className="ea-fill2" />
      <path d="M54 45h12M8 45h12M100 45h12" className="ea-line" />
      <circle cx="60" cy="45" r="4" className="ea-dot" />
    </svg>
  )
  return (
    <svg className="empty-art" viewBox="0 0 120 90" fill="none">
      <rect x="18" y="12" width="84" height="64" rx="8" className="ea-fill" />
      <path d="M30 62l18-20 12 13 9-9 21 16" className="ea-line" />
      <circle cx="80" cy="30" r="6" className="ea-dot" />
    </svg>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} />
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (ms === null) return
    const t = setInterval(() => ref.current(), ms)
    return () => clearInterval(t)
  }, [ms])
}

export function useNow(active: boolean) {
  const [n, setN] = useState(Date.now())
  useInterval(() => setN(Date.now()), active ? 100 : null)
  return n
}

export async function copyText(t: string) {
  try { await navigator.clipboard.writeText(t); return true } catch {
    const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select()
    const ok = document.execCommand('copy'); ta.remove(); return ok
  }
}
