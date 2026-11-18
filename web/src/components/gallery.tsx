import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Copy, Download, Heart, RotateCcw, Trash2, X, Check, FolderOpen } from 'lucide-react'
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
    `渠道：${r.channel_name}（${apiTypeLabels[r.api_type] || r.api_type}）`,
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
      toast(next.favorite ? '已收藏为资产' : '已取消收藏')
    },
    async copy(img: Img) {
      if (await copyText(recipeText(img))) toast('配方已复制')
    },
    reuse(img: Img) {
      const r = img.recipe
      const exists = channels.some(c => c.id === r.channel_id)
      setComposer({ text: r.prompt, chips: [], vars: {}, ...(exists ? { channelId: r.channel_id, model: r.model } : {}), params: { ...(r.params || {}) } })
      go('generate')
      toast(exists ? '配方已填入' : '配方已填入，原渠道已删除', exists ? 'ok' : 'info')
    },
    async remove(img: Img) {
      if (img.favorite && !confirm('这张图是资产，确定删除原图吗？')) return
      await api(`/api/images/${img.id}`, { method: 'DELETE' })
      onRemove(img.id)
      toast('已删除')
    },
  }
}

export function ImageTile({ img, onOpen, actions, selected, onSelect }: {
  img: Img; onOpen: () => void; actions: ReturnType<typeof useImageActions>
  selected?: boolean; onSelect?: () => void
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <figure className={`tile ${selected ? 'is-selected' : ''} ${onSelect ? 'is-selecting' : ''}`} style={{ aspectRatio: `${img.width || 1} / ${img.height || 1}` }}>
      <img src={img.thumb} alt="" loading="lazy" decoding="async" className={loaded ? 'is-loaded' : ''} onLoad={() => setLoaded(true)}
        onClick={onSelect || onOpen} draggable={false} />
      {onSelect && <button className="tile-check" onClick={onSelect} aria-label="选择">{selected && <Check size={14} strokeWidth={3} />}</button>}
      {!onSelect && (
        <>
          <div className="tile-shade" onClick={onOpen} />
          <button className={`tile-fav ${img.favorite ? 'is-on' : ''}`} onClick={() => actions.fav(img)} aria-label={img.favorite ? '取消收藏' : '收藏'} title={img.favorite ? '取消收藏' : '收藏'}>
            <Heart size={16} fill={img.favorite ? 'currentColor' : 'none'} />
          </button>
          <figcaption className="tile-bar">
            <span className="tile-meta">{img.width}×{img.height}</span>
            <span className="tile-actions">
              <a className="tile-btn" href={`/api/images/${img.id}/download`} title="下载" aria-label="下载"><Download size={15} /></a>
              <button className="tile-btn" onClick={() => actions.copy(img)} title="复制配方" aria-label="复制配方"><Copy size={15} /></button>
              <button className="tile-btn" onClick={() => actions.reuse(img)} title="用这个配方再来" aria-label="用这个配方再来"><RotateCcw size={15} /></button>
              <button className="tile-btn danger" onClick={() => actions.remove(img)} title="删除" aria-label="删除"><Trash2 size={15} /></button>
            </span>
          </figcaption>
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
        {index > 0 && <button className="lb-nav prev" onClick={() => onIndex(index - 1)} aria-label="上一张"><ChevronLeft size={22} /></button>}
        {index < list.length - 1 && <button className="lb-nav next" onClick={() => onIndex(index + 1)} aria-label="下一张"><ChevronRight size={22} /></button>}
        <div className="lb-count">{index + 1} / {list.length}</div>
      </div>
      <aside className="lb-side">
        <div className="lb-head">
          <button className={`btn ${img.favorite ? 'btn-accent' : 'btn-ghost'}`} onClick={() => actions.fav(img)}>
            <Heart size={15} fill={img.favorite ? 'currentColor' : 'none'} />{img.favorite ? '已收藏' : '收藏'}
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
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
          <dl className="lb-grid">
            <dt>渠道</dt><dd>{r.channel_name || '—'}</dd>
            <dt>接口</dt><dd>{apiTypeLabels[r.api_type] || '—'}{r.ref_count ? ` · 参考图 ${r.ref_count} 张` : ''}</dd>
            <dt>模型</dt><dd className="mono">{r.model}</dd>
            {params.map(p => <FragmentRow key={p.k} k={p.k} v={p.v} />)}
            <dt>实际尺寸</dt><dd className="mono">{img.width}×{img.height}<span className="muted"> · {ratioOf(img.width, img.height)}</span></dd>
            <dt>文件</dt><dd className="mono">{img.format.toUpperCase()} · {fmtBytes(img.bytes)}</dd>
            <dt>耗时</dt><dd className="mono">{fmtDuration(r.duration_ms)}</dd>
            <dt>时间</dt><dd>{fmtTime(img.created_at)}</dd>
            {r.tool_path && <><dt>链路</dt><dd>对话工具链路</dd></>}
          </dl>
          {img.favorite && (
            <section className="lb-sec">
              <div className="lb-label">相册</div>
              <div className="lb-album">
                <FolderOpen size={15} />
                <input list="album-list" value={album} placeholder="未归档" onChange={e => setAlbum(e.target.value)}
                  onBlur={() => album !== img.album && save({ album })} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                <datalist id="album-list">{albums.map(a => <option key={a} value={a} />)}</datalist>
              </div>
              <div className="lb-label" style={{ marginTop: 14 }}>标签</div>
              <TagInput value={img.tags} onChange={tags => save({ tags })} placeholder="添加标签" />
            </section>
          )}
        </div>
        <div className="lb-actions">
          <a className="btn btn-ghost" href={`/api/images/${img.id}/download`}><Download size={15} />下载原图</a>
          <button className="btn btn-ghost" onClick={() => actions.copy(img)}><Copy size={15} />复制配方</button>
          <button className="btn btn-ghost" onClick={() => { actions.reuse(img); onClose() }}><RotateCcw size={15} />再来一张</button>
          <button className="btn btn-ghost danger" onClick={async () => { await actions.remove(img); if (list.length <= 1) onClose() }}><Trash2 size={15} />删除</button>
        </div>
      </aside>
    </div>, document.body)
}

function FragmentRow({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>
}
