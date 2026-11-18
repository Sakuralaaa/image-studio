import { useEffect, useState } from 'react'
import { Search, CheckSquare, PackageOpen, X, FolderOpen } from 'lucide-react'
import { api, downloadPost, type Facet, type Img } from '../api'
import { useStore } from '../store'
import { Empty, Masonry, Select, Spinner } from '../components/ui'
import { ImageTile, Lightbox, useImageActions } from '../components/gallery'
import { useImages, useSentinel } from '../components/useImages'
import { PageHead } from './Generate'
import { fmtBytes } from '../labels'

interface Facets { albums: Facet[]; tags: Facet[]; channels: Facet[]; models: Facet[]; favorites: number; total: number; bytes: number }

export default function Assets() {
  const { galleryTick, toast } = useStore()
  const [q, setQ] = useState('')
  const [qd, setQd] = useState('')
  const [album, setAlbum] = useState('')
  const [tag, setTag] = useState('')
  const [channel, setChannel] = useState('')
  const [model, setModel] = useState('')
  const [facets, setFacets] = useState<Facets | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [sel, setSel] = useState<number[]>([])
  const [lb, setLb] = useState<number | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { const t = setTimeout(() => setQd(q.trim()), 280); return () => clearTimeout(t) }, [q])
  const reloadFacets = () => api<Facets>('/api/facets').then(setFacets).catch(() => {})
  useEffect(() => { reloadFacets() }, [galleryTick, tick])

  const g = useImages({ fav: '1', q: qd, album, tag, channel, model }, galleryTick + tick)
  const sentinel = useSentinel(g.more, !!g.next)
  const actions = useImageActions(img => { if (!img.favorite) g.remove(img.id); else g.update(img); setTick(t => t + 1) }, id => { g.remove(id); setTick(t => t + 1) })
  useEffect(() => { if (lb !== null && lb >= g.images.length) setLb(g.images.length ? g.images.length - 1 : null) }, [g.images.length])

  const filtered = !!(qd || album || tag || channel || model)
  const toggle = (id: number) => setSel(s => (s.includes(id) ? s.filter(x => x !== id) : [...s, id]))
  const exportZip = () => {
    if (selecting && sel.length) downloadPost('/api/images/export', { ids: sel })
    else if (selecting) { toast('先选择要导出的图片', 'info'); return }
    else downloadPost('/api/images/export', { fav: true })
    toast('正在打包下载')
  }

  return (
    <div className="page page-assets">
      <PageHead title="资产">
        {facets && <span className="head-stat">{facets.favorites} 张 · {fmtBytes(facets.bytes)}</span>}
      </PageHead>

      <div className="toolbar">
        <div className="search grow"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索提示词、标签、渠道或模型" /></div>
        {facets && facets.channels.length > 1 && <Select className="filter-sel" value={channel} placeholder="全部渠道" onChange={setChannel} options={[{ value: '', label: '全部渠道' }, ...facets.channels.map(f => ({ value: f.name, label: f.name, hint: String(f.count) }))]} />}
        {facets && facets.models.length > 1 && <Select className="filter-sel" value={model} placeholder="全部模型" onChange={setModel} options={[{ value: '', label: '全部模型' }, ...facets.models.map(f => ({ value: f.name, label: f.name, hint: String(f.count) }))]} />}
        <button className={`btn ${selecting ? 'btn-ink' : 'btn-ghost'}`} onClick={() => { setSelecting(s => !s); setSel([]) }}>
          {selecting ? <X size={15} /> : <CheckSquare size={15} />}<span className="hide-sm">{selecting ? '取消选择' : '批量选择'}</span>
        </button>
        <button className="btn btn-ghost" onClick={exportZip}><PackageOpen size={15} /><span className="hide-sm">{selecting ? `导出所选${sel.length ? ` ${sel.length}` : ''}` : '全部导出'}</span></button>
      </div>

      {facets && (facets.albums.length > 0 || facets.tags.length > 0) && (
        <div className="albums">
          <button className={`album ${!album ? 'is-on' : ''}`} onClick={() => setAlbum('')}><span>全部</span><em>{facets.favorites}</em></button>
          {facets.albums.map(a => (
            <button key={a.name} className={`album ${album === a.name ? 'is-on' : ''}`} onClick={() => setAlbum(album === a.name ? '' : a.name)}>
              <FolderOpen size={14} /><span>{a.name}</span><em>{a.count}</em>
            </button>
          ))}
          {facets.tags.length > 0 && <span className="albums-sep" />}
          {facets.tags.map(t => (
            <button key={t.name} className={`chip ${tag === t.name ? 'is-on' : ''}`} onClick={() => setTag(tag === t.name ? '' : t.name)}>#{t.name}</button>
          ))}
        </div>
      )}

      {g.loaded && g.images.length === 0 ? (
        <Empty art="stack" title={filtered ? '没有匹配的资产' : '还没有资产'} text={filtered ? undefined : '在任意图片上点心形，就会永久收进这里'} />
      ) : (
        <Masonry items={g.images} keyOf={i => i.id} aspect={i => (i.width || 1) / (i.height || 1)}
          render={(img: Img) => <ImageTile img={img} actions={actions} onOpen={() => setLb(g.images.findIndex(x => x.id === img.id))}
            selected={sel.includes(img.id)} onSelect={selecting ? () => toggle(img.id) : undefined} />} />
      )}
      <div ref={sentinel} className="sentinel">{g.loading && g.images.length > 0 && <Spinner />}</div>

      {lb !== null && g.images[lb] && <Lightbox list={g.images} index={lb} onIndex={setLb} onClose={() => setLb(null)} actions={actions}
        albums={(facets?.albums || []).map(a => a.name)} onChange={img => { g.update(img); setTick(t => t + 1) }} />}
    </div>
  )
}
