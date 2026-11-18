import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'

// 生成等待面：铺满整块区域的柔和闪烁小圆角方块。
// 出图后：方块取样图片对应位置的颜色并长大合拢成马赛克，随后错落淡出，原图在下面淡入。
// 方块数量有上限（大面板自动拉开间距），动画只改 opacity / 位置尺寸，交给浏览器合成。

const CELL = 14, CELL_SM = 6, SM_MAX = 96, MAX_CELLS = 256
const BLINK = 2000, FILL = 500, FADE = 600, FADE_JITTER = 300, IMG_IN = 900

const reduce = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const rnd = (i: number, s: number) => { const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v) }

type Grid = { cols: number; rows: number; px: number; py: number; cell: number; radius: number; key: string }

function layout(w: number, h: number): Grid {
  const small = Math.max(w, h) <= SM_MAX
  const cell = small ? CELL_SM : CELL
  let pitch = cell * 2
  let cols = 0, rows = 0
  for (;;) {
    cols = Math.max(1, Math.round(w / pitch)); rows = Math.max(1, Math.round(h / pitch))
    if (cols * rows <= MAX_CELLS) break
    pitch += 1
  }
  // 按整块宽高均分，四周留半个间距，边缘不会出现被裁掉的半个方块
  const px = w / cols, py = h / rows
  return { cols, rows, px, py, cell: Math.min(cell, px * 0.6, py * 0.6), radius: small ? 2 : 3, key: `${cols}x${rows}@${Math.round(w)}x${Math.round(h)}` }
}

function sample(src: string, cols: number, rows: number): Promise<string[] | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = cols; c.height = rows
        const x = c.getContext('2d', { willReadFrequently: true })!
        // 与 object-fit: cover 的裁切保持一致
        const ar = img.naturalWidth / img.naturalHeight, br = cols / rows
        let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0
        if (ar > br) { sw = sh * br; sx = (img.naturalWidth - sw) / 2 } else { sh = sw / br; sy = (img.naturalHeight - sh) / 2 }
        x.imageSmoothingQuality = 'high'
        x.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows)
        const d = x.getImageData(0, 0, cols, rows).data
        resolve(Array.from({ length: cols * rows }, (_, i) => `rgb(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]})`))
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** 等待/揭示面。src 为空时持续闪烁；给出 src 后揭示，结束时回调 onDone。 */
export function PixelField({ src, onDone, size = 'md' }: { src?: string; onDone?: () => void; size?: 'sm' | 'md' }) {
  const root = useRef<HTMLDivElement>(null)
  const [grid, setGrid] = useState<Grid | null>(null)
  const [colors, setColors] = useState<string[] | null>(null)
  const [phase, setPhase] = useState<'wait' | 'fill' | 'fade'>('wait')
  const done = useRef(onDone)
  done.current = onDone
  const rm = useMemo(reduce, [])

  useLayoutEffect(() => {
    const el = root.current!
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      const g = layout(r.width, r.height)
      setGrid(cur => (cur && cur.cols === g.cols && cur.rows === g.rows && Math.abs(cur.px - g.px) < 0.5 && Math.abs(cur.py - g.py) < 0.5 ? cur : g))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 有了图片：取样颜色 → 合拢 → 淡出
  const cols = grid?.cols, rows = grid?.rows
  useEffect(() => {
    if (!src || !cols || !rows) return
    if (rm) { done.current?.(); return }
    let live = true
    const timers: number[] = []
    sample(src, cols, rows).then(c => {
      if (!live) return
      if (!c) { done.current?.(); return }
      setColors(c)
      // 下一帧再切到合拢，让过渡从当前状态开始
      requestAnimationFrame(() => requestAnimationFrame(() => live && setPhase('fill')))
      timers.push(window.setTimeout(() => live && setPhase('fade'), FILL + 40))
      timers.push(window.setTimeout(() => live && done.current?.(), FILL + 40 + Math.max(FADE + FADE_JITTER, IMG_IN) + 60))
    })
    return () => { live = false; timers.forEach(clearTimeout) }
  }, [src, cols, rows, rm])

  const cells = useMemo(() => {
    if (!grid) return []
    return Array.from({ length: grid.cols * grid.rows }, (_, i) => ({ i, c: i % grid.cols, r: Math.floor(i / grid.cols) }))
  }, [grid])

  const filled = phase !== 'wait'
  return (
    <div ref={root} className={`pixel-field pixel-${size} ${filled ? 'is-filled' : ''} ${phase === 'fade' ? 'is-fading' : ''}`} aria-hidden="true">
      {src && colors && <img className="pf-img" src={src} alt="" draggable={false} style={{ transition: `opacity ${IMG_IN}ms ease-out ${FILL}ms` }} />}
      {grid && cells.map(({ i, c, r }) => {
        const cx = (c + 0.5) * grid.px, cy = (r + 0.5) * grid.py
        const st: CSSProperties = filled
          ? {
              left: c * grid.px - 0.25, top: r * grid.py - 0.25, width: grid.px + 0.5, height: grid.py + 0.5,
              background: colors?.[i], borderRadius: grid.radius,
              opacity: phase === 'fade' ? 0 : 1,
              transitionDelay: phase === 'fade' ? `${Math.round(rnd(i, 2) * FADE_JITTER)}ms` : '0ms',
            }
          : {
              left: cx - grid.cell / 2, top: cy - grid.cell / 2, width: grid.cell, height: grid.cell, borderRadius: grid.radius,
              animationDelay: `${-Math.round(rnd(i, 1) * BLINK)}ms`,
            }
        return <i key={i} className="pf-cell" style={st} />
      })}
    </div>
  )
}
