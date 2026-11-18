import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Copy, Download, Star, RotateCcw, Trash2, X, Check, FolderOpen, Clock } from 'lucide-react'
import { api, type Img } from '../api'
import { useStore } from '../store'
import { apiTypeLabels, describeParams, fmtBytes, fmtDuration, fmtTime, ratioOf } from '../labels'
import { TagInput, copyText } from './ui'

export function recipeText(img: Img) {
  const r = img.recipe
  const params = describeParams(r.params || {}).map(p => `${p.k}：${p.v}`).join('\n')
  return [
    `提示词：${r.prompt}`,
    r.sent_prompt && r.sent_prompt !== r.prompt ? `实际发送：${r.sent_prompt}` : '',
    r.channel_name ? `渠道：${r.channel_name}（${apiTypeLabels[r.api_type] || r.api_type}）` : '',
    `模型：${r.model}`,
    params,
    `输出：${img.width}×${img.height} · ${img.format.toUpperCase()} · ${fmtBytes(img.bytes)}`,
    `耗时：${fmtDuration(r.duration_ms)}`,
  ].filter(Boolean).join('\n')
}

export function useImageActions(onChange: (img: Img) => void, onRemove: (id: number) => void) {
  const { toast, setComposer, go, channels } = useStore()
  return {
    async fav(img: Img) {
      const next = await api<Img>(`/api/images/${img.id}`, { method: 'PATCH', body: { favorite: !img.favorite } })
      onChange(next)
      toast(next.favorite ? '已收藏，不会被自动清理' : '已取消收藏')
    },
    async copy(img: Img) {
      if (await copyText(recipeText(img))) toast('配方已复制')
    },
    reuse(img: Img) {
      const r = img.recipe
      const exists = channels.some(c => c.id === r.channel_id)
      setComposer({ text: r.prompt, chips: [], vars: {}, ...(exists ? { channelId: r.channel_id, model: r.model } : {}), params: { ...(r.params || {}) } })
      go('generate')
      toast(exists ? '配方已填入' : '配方已填入，原模型已不可用', exists ? 'ok' : 'info')
    },
    async remove(img: Img) {
      if (img.favorite && !confirm('这张图已收藏，确定删除吗？')) return
      await api(`/api/images/${img.id}`, { method: 'DELETE' })
      onRemove(img.id)
      toast('已删除')
    },
  }
}

// ---------- 等高行图库（两端对齐） ----------
export const GAP = 8
const clampAspect = (a: number) => Math.min(2.4, Math.max(0.5, a || 1))

export function targetHeight(w: number) {
  if (w < 520) return 168
  if (w < 900) return 200
  return 248
}

interface Row { idx: number[]; h: number; partial: boolean }

export function layoutRows(aspects: number[], W: number, T: number): Row[] {
  const rows: Row[] = []
  const hOf = (sum: number, n: number) => (W - GAP * (n - 1)) / sum
  let cur: number[] = []
  let sum = 0
  aspects.forEach((raw, i) => {
    const a = clampAspect(raw)
    if (cur.length) {
      const hc = hOf(sum, cur.length)
      const hn = hOf(sum + a, cur.length + 1)
      if (hn < T && Math.abs(hn - T) > Math.abs(hc - T)) {
        rows.push({ idx: cur, h: hc, partial: false })
        cur = []; sum = 0
      }
    }
    cur.push(i); sum += a
  })
  if (cur.length) {
    const h = hOf(sum, cur.length)
    if (h <= T * 1.25) rows.push({ idx: cur, h, partial: false })
    else if (rows.length) {
      // 末行不满：与上一行合并后重新切成两行，让两行都两端对齐
      const prev = rows.pop()!
      const all = [...prev.idx, ...cur]
      const as = all.map(i => clampAspect(aspects[i]))
      let best: { k: number; cost: number; h1: number; h2: number } | null = null
      for (let k = 1; k < all.length; k++) {
        const s1 = as.slice(0, k).reduce((x, y) => x + y, 0)
        const s2 = as.slice(k).reduce((x, y) => x + y, 0)
        const h1 = hOf(s1, k), h2 = hOf(s2, all.length - k)
        const cost = Math.abs(h1 - T) + Math.abs(h2 - T)
        if (!best || cost < best.cost) best = { k, cost, h1, h2 }
      }
      const sumAll = as.reduce((x, y) => x + y, 0)
      const hAll = hOf(sumAll, all.length)
      const twoOk = best && Math.max(best.h1, best.h2) <= T * 1.6 && Math.min(best.h1, best.h2) >= T * 0.6
      const oneOk = hAll >= T * 0.6
      if (oneOk && (!twoOk || Math.abs(hAll - T) <= best!.cost / 2)) {
        rows.push({ idx: all, h: hAll, partial: false })
      } else if (twoOk) {
        rows.push({ idx: all.slice(0, best!.k), h: best!.h1, partial: false }, { idx: all.slice(best!.k), h: best!.h2, partial: false })
      } else {
        rows.push(prev, { idx: cur, h: T, partial: true })
      }
    } else rows.push({ idx: cur, h: Math.min(T, h), partial: true })
  }
  return rows
}

export function Justified<T>({ items, aspect, render, keyOf }: {
  items: T[]; aspect: (t: T) => number; render: (t: T) => ReactNode; keyOf: (t: T) => string | number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const calc = () => setW(el.clientWidth)
    calc()
    const ro = new ResizeObserver(calc)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const T = targetHeight(w)
  const rows = w > 0 ? layoutRows(items.map(aspect), w, T) : []
  return (
    <div ref={ref} className="jgrid">
      {rows.map((r, ri) => (
        <div key={ri} className={`jrow ${r.partial ? 'is-partial' : ''}`} style={{ height: Math.round(r.h) }}>
          {r.idx.map(i => {
            const a = clampAspect(aspect(items[i]))
            return (
              <div key={keyOf(items[i])} className="jcell" style={r.partial ? { flex: `0 0 ${Math.round(a * r.h)}px` } : { flex: `${a} 1 0` }}>
                {render(items[i])}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

export function leftText(exp: number) {
  const h = (exp - Date.now()) / 3600e3
  if (h <= 1) return '即将清理'
  if (h < 48) return `${Math.ceil(h)} 小时`
  return `${Math.ceil(h / 24)} 天`
}

export function ImageTile({ img, onOpen, actions, selected, onSelect }: {
  img: Img; onOpen: () => void; actions: ReturnType<typeof useImageActions>
  selected?: boolean; onSelect?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [full, setFull] = useState(false)
  return (
    <figure className={`tile ${selected ? 'is-selected' : ''} ${onSelect ? 'is-selecting' : ''} ${img.favorite ? 'is-fav' : ''}`}>
      <img src={img.thumb} alt="" loading="lazy" decoding="async" className={loaded ? 'is-loaded' : ''} onLoad={() => setLoaded(true)} draggable={false} />
      {loaded && <img src={img.url} alt="" loading="lazy" decoding="async" className={`tile-full ${full ? 'is-loaded' : ''}`} onLoad={() => setFull(true)} draggable={false} />}
      <button className="tile-hit" onClick={onSelect || onOpen} aria-label={onSelect ? '选择' : '查看'} />
      {onSelect && <span className="tile-check">{selected && <Check size={14} strokeWidth={3} />}</span>}
      {!onSelect && (
        <>
          {!img.favorite && !!img.expires_at && <span className="tile-exp"><Clock size={12} />{leftText(img.expires_at)}</span>}
          <button className="tile-fav" onClick={() => actions.fav(img)} aria-label={img.favorite ? '取消收藏' : '收藏'} title={img.favorite ? '取消收藏' : '收藏'}>
            <Star size={16} fill={img.favorite ? 'currentColor' : 'none'} />
          </button>
          <div className="tile-bar">
            <span className="tile-meta">{img.width}×{img.height}</span>
            <span className="tile-actions">
              <a className="tile-btn" href={`/api/images/${img.id}/download`} title="下载" aria-label="下载"><Download size={16} /></a>
              <button className="tile-btn" onClick={() => actions.reuse(img)} title="再来一张" aria-label="再来一张"><RotateCcw size={16} /></button>
              <button className="tile-btn" onClick={() => actions.remove(img)} title="删除" aria-label="删除"><Trash2 size={16} /></button>
            </span>
          </div>
        </>
      )}
    </figure>
  )
}

export function Lightbox({ list, index, onIndex, onClose, actions, onChange, albums = [] }: {
  list: Img[]; index: number; onIndex: (i: number) => void; onClose: () => void
  actions: ReturnType<typeof useImageActions>; onChange: (img: Img) => void; albums?: string[]
}) {
  const img = list[index]
  const [album, setAlbum] = useState(img?.album || '')
  useEffect(() => { setAlbum(img?.album || '') }, [img?.id])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
      if (e.key === 'ArrowRight' && index < list.length - 1) onIndex(index + 1)
    }
    window.addEventListener('keydown', key)
    document.body.classList.add('no-scroll')
    return () => { window.removeEventListener('keydown', key); document.body.classList.remove('no-scroll') }
  }, [index, list.length, onClose, onIndex])
  if (!img) return null
  const r = img.recipe
  const params = describeParams(r.params || {})
  const save = async (patch: any) => onChange(await api<Img>(`/api/images/${img.id}`, { method: 'PATCH', body: patch }))
  return createPortal(
    <div className="lb" role="dialog" aria-modal="true">
      <div className="lb-stage" onClick={e => e.target === e.currentTarget && onClose()}>
        <img key={img.id} src={img.url} alt="" className="lb-img" />
        {index > 0 && <button className="lb-nav prev" onClick={() => onIndex(index - 1)} aria-label="上一张"><ChevronLeft size={20} /></button>}
        {index < list.length - 1 && <button className="lb-nav next" onClick={() => onIndex(index + 1)} aria-label="下一张"><ChevronRight size={20} /></button>}
        <div className="lb-count">{index + 1} / {list.length}</div>
        <button className="lb-close" onClick={onClose} aria-label="关闭"><X size={20} /></button>
      </div>
      <aside className="lb-side">
        <div className="lb-head">
          <span className="lb-title">配方</span>
          <button className={`btn btn-sm ${img.favorite ? 'btn-primary' : 'btn-secondary'}`} onClick={() => actions.fav(img)}>
            <Star size={14} fill={img.favorite ? 'currentColor' : 'none'} />{img.favorite ? '已收藏' : '收藏'}
          </button>
        </div>
        <div className="lb-scroll">
          <section className="lb-sec">
            <div className="lb-label">提示词</div>
            <p className="lb-prompt">{r.prompt}</p>
          </section>
          {r.sent_prompt && r.sent_prompt !== r.prompt && (
            <section className="lb-sec">
              <div className="lb-label">实际发送</div>
              <p className="lb-prompt is-sent">{r.sent_prompt}</p>
            </section>
          )}
          <section className="lb-sec">
            <dl className="kv">
              {img.owner && <><dt>用户</dt><dd>{img.owner}</dd></>}
              {r.channel_name && <><dt>渠道</dt><dd>{r.channel_name}</dd>
              <dt>接口</dt><dd>{apiTypeLabels[r.api_type] || '—'}{r.ref_count ? ` · 参考图 ${r.ref_count} 张` : ''}</dd></>}
              {!r.channel_name && r.ref_count > 0 && <><dt>参考图</dt><dd>{r.ref_count} 张</dd></>}
              <dt>模型</dt><dd>{r.model}</dd>
              {params.map(p => <KV key={p.k} k={p.k} v={p.v} />)}
              <dt>实际尺寸</dt><dd>{img.width}×{img.height} · {ratioOf(img.width, img.height)}</dd>
              <dt>文件</dt><dd>{img.format.toUpperCase()} · {fmtBytes(img.bytes)}</dd>
              <dt>耗时</dt><dd>{fmtDuration(r.duration_ms)}</dd>
              <dt>时间</dt><dd>{fmtTime(img.created_at)}</dd>
              {!img.favorite && !!img.expires_at && <><dt>保留至</dt><dd className="is-warn">{fmtTime(img.expires_at)}</dd></>}
            </dl>
          </section>
          {img.favorite && (
            <section className="lb-sec">
              <div className="lb-label">相册</div>
              <div className="lb-album">
                <FolderOpen size={16} />
                <input list="album-list" value={album} placeholder="未归档" onChange={e => setAlbum(e.target.value)}
                  onBlur={() => album !== img.album && save({ album })} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                <datalist id="album-list">{albums.map(a => <option key={a} value={a} />)}</datalist>
              </div>
              <div className="lb-label">标签</div>
              <TagInput value={img.tags} onChange={tags => save({ tags })} placeholder="添加标签" />
            </section>
          )}
        </div>
        <div className="lb-actions">
          <a className="btn btn-secondary" href={`/api/images/${img.id}/download`}><Download size={16} />下载原图</a>
          <button className="btn btn-secondary" onClick={() => actions.copy(img)}><Copy size={16} />复制配方</button>
          <button className="btn btn-secondary" onClick={() => { actions.reuse(img); onClose() }}><RotateCcw size={16} />再来一张</button>
          <button className="btn btn-secondary is-danger" onClick={async () => { await actions.remove(img); if (list.length <= 1) onClose() }}><Trash2 size={16} />删除</button>
        </div>
      </aside>
    </div>, document.body)
}

function KV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>
}
