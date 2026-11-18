import { useEffect, useRef } from 'react'

// 等待时：一片轻轻闪烁的小圆角方块；出图时：方块取样图片颜色、长大填满，再淡出露出原图。
// 全部画在一个 canvas 上，30fps 节流，页面不可见时停止，避免大量 DOM 节点吃 CPU。

const reduce = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const noise = (i: number, s: number) => { const v = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453; return v - Math.floor(v) }
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.pow(1 - t, 3))

type Opts = { cell: number; gap: number; radius: number }
const BLINK = 2000, FILL = 500, FADE = 600, FADE_DELAY = 300

function sample(src: string, cols: number, rows: number): Promise<Uint8ClampedArray | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = cols; c.height = rows
        const x = c.getContext('2d', { willReadFrequently: true })!
        // 与 object-fit: cover 对齐取样
        const ar = img.width / img.height, br = cols / rows
        let sw = img.width, sh = img.height, sx = 0, sy = 0
        if (ar > br) { sw = img.height * br; sx = (img.width - sw) / 2 } else { sh = img.width / br; sy = (img.height - sh) / 2 }
        x.drawImage(img, sx, sy, sw, sh, 0, 0, cols, rows)
        resolve(x.getImageData(0, 0, cols, rows).data)
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** 网格动画画布。src 为空时持续闪烁；给出 src 后执行揭示，结束时回调 onDone。 */
export function PixelField({ src, onDone, size = 'md' }: { src?: string; onDone?: () => void; size?: 'sm' | 'md' }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ src?: string; colors: Uint8ClampedArray | null; revealAt: number; done: boolean }>({ colors: null, revealAt: 0, done: false })
  const doneRef = useRef(onDone)
  doneRef.current = onDone
  const o: Opts = size === 'sm' ? { cell: 5, gap: 5, radius: 1.5 } : { cell: 14, gap: 14, radius: 3 }

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const pitch = o.cell + o.gap
    let W = 0, H = 0, cols = 0, rows = 0, dpr = 1
    const resize = () => {
      const r = cv.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      W = r.width; H = r.height
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr))
      const nc = Math.ceil(W / pitch) + 1, nr = Math.ceil(H / pitch) + 1
      if (nc !== cols || nr !== rows) { cols = nc; rows = nr; if (state.current.src) resample() }
    }
    const resample = () => {
      const s = state.current.src
      if (!s) return
      sample(s, cols, rows).then(c => {
        if (state.current.src !== s) return
        if (!c) { state.current.done = true; doneRef.current?.(); return }
        state.current.colors = c; state.current.revealAt = performance.now()
      })
    }
    ;(cv as any).__resample = resample
    const ro = new ResizeObserver(resize)
    ro.observe(cv)
    resize()

    const cs = getComputedStyle(cv)
    const base = cs.color || 'rgb(120,120,120)'
    const cover = cs.getPropertyValue('--pf-bg').trim()
    let raf = 0, last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (document.hidden || t - last < 33) return
      last = t
      const st = state.current
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const offX = (W - (cols - 1) * pitch - o.cell) / 2, offY = (H - (rows - 1) * pitch - o.cell) / 2
      const rt = st.colors && st.revealAt ? t - st.revealAt : -1
      if (rt >= FILL + FADE_DELAY + FADE) {
        if (!st.done) { st.done = true; doneRef.current?.() }
        return
      }
      // 揭示前用底色遮住下面的图，方块长满后撤掉
      if (cover) {
        ctx.globalAlpha = rt < 0 ? 1 : 1 - ease(rt / FILL)
        ctx.fillStyle = cover
        ctx.fillRect(0, 0, W, H)
      }
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c
          let x = offX + c * pitch, y = offY + r * pitch, s = o.cell, a: number, col = base
          if (rt < 0) {
            const ph = ((t + noise(i, 1) * BLINK) % BLINK) / BLINK
            a = 0.12 + (0.5 - 0.12) * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)) * (0.6 + noise(i, 3) * 0.6)
          } else {
            const k = ease(rt / FILL)
            const grow = (pitch + 1 - o.cell) * k
            x -= grow / 2; y -= grow / 2; s += grow
            const d = st.colors!
            col = `rgb(${d[i * 4]},${d[i * 4 + 1]},${d[i * 4 + 2]})`
            const ft = rt - FILL - noise(i, 2) * FADE_DELAY
            a = (0.35 + 0.65 * k) * (ft > 0 ? 1 - ease(ft / FADE) : 1)
          }
          if (a <= 0.01) continue
          ctx.globalAlpha = Math.min(1, a)
          ctx.fillStyle = col
          ctx.beginPath()
          ctx.roundRect(x, y, s, s, o.radius)
          ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }
    if (reduce()) {
      // 减少动态效果：画静态网格
      draw(performance.now()); cancelAnimationFrame(raf)
    } else raf = requestAnimationFrame(draw)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [size])

  useEffect(() => {
    if (!src || state.current.src === src) return
    state.current.src = src
    if (reduce()) { state.current.done = true; onDone?.(); return }
    ;(ref.current as any)?.__resample?.()
  }, [src])

  return <canvas ref={ref} className={`pixel-field pixel-${size}`} aria-hidden="true" />
}
