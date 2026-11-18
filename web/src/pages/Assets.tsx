import { useEffect, useState } from 'react'
import { Search, CheckSquare, PackageOpen, X, FolderOpen } from 'lucide-react'
import { api, downloadPost, type Facet, type Img, type UserRow } from '../api'
import { useStore } from '../store'
import { Empty, Select, Spinner } from '../components/ui'
import { ImageTile, Justified, Lightbox, useImageActions } from '../components/gallery'
import { useImages, useSentinel } from '../components/useImages'
import { PageHead } from './Compare'
import { fmtBytes } from '../labels'

interface Facets { albums: Facet[]; tags: Facet[]; channels: Facet[]; models: Facet[]; users?: Facet[]; favorites: number; total: number; bytes: number }

// 管理员查看范围：我的 / 全部用户 / 某个用户
export function UserScope({ value, onChange, tick, noCount }: { value: string; onChange: (v: string) => void; tick?: number; noCount?: boolean }) {
  const size = noCount ? undefined : 'sm'
  const [users, setUsers] = useState<Facet[]>([])
  useEffect(() => {
    if (noCount) api<UserRow[]>('/api/users').then(l => setUsers(l.map(u => ({ name: `${u.id}|${u.display}`, count: 0 })))).catch(() => {})
    else api<Facets>('/api/facets?user=all').then(f => setUsers(f.users || [])).catch(() => {})
  }, [tick, noCount])
  if (users.length < 2 && (value === 'me' || value === '')) return null
  return <Select size={size as any} className={noCount ? "mk-scope" : "filter-sel"} value={value || 'all'} onChange={v => onChange(v === 'all' ? '' : v)}
    options={[{ value: 'me', label: '我的' }, { value: 'all', label: '全部用户' }, ...users.map(f => { const [id, name] = f.name.split('|'); return { value: id, label: name || '未知用户', hint: noCount ? undefined : String(f.count) } })]} />
}

export default function Assets() {
  const { galleryTick, toast, isAdmin } = useStore()
  const [scope, setScope] = useState('me')
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
  const reloadFacets = () => api<Facets>('/api/facets' + (isAdmin ? '?user=' + (scope || 'all') : '')).then(setFacets).catch(() => {})
  useEffect(() => { reloadFacets() }, [galleryTick, tick, scope])

  const g = useImages({ fav: '1', q: qd, album, tag, channel, model, user: isAdmin ? scope : '' }, galleryTick + tick)
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
      <PageHead title="资产" sub={facets ? `${facets.favorites} 张 · ${fmtBytes(facets.bytes)}` : undefined} />

      <div className="toolbar">
        <div className="search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder={isAdmin ? "搜索提示词、标签、渠道或模型" : "搜索提示词、标签或模型"} /></div>
        {isAdmin && <UserScope value={scope} onChange={setScope} tick={tick} />}
        {isAdmin && facets && facets.channels.length > 1 && <Select className="filter-sel" value={channel} placeholder="全部渠道" onChange={setChannel} options={[{ value: '', label: '全部渠道' }, ...facets.channels.map(f => ({ value: f.name, label: f.name, hint: String(f.count) }))]} />}
        {facets && facets.models.length > 1 && <Select className="filter-sel" value={model} placeholder="全部模型" onChange={setModel} options={[{ value: '', label: '全部模型' }, ...facets.models.map(f => ({ value: f.name, label: f.name, hint: String(f.count) }))]} />}
        <button className={`btn ${selecting ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setSelecting(s => !s); setSel([]) }}>
          {selecting ? <X size={16} /> : <CheckSquare size={16} />}<span className="hide-xs">{selecting ? '取消选择' : '批量选择'}</span>
        </button>
        <button className="btn btn-secondary" onClick={exportZip}><PackageOpen size={16} /><span className="hide-xs">{selecting ? `导出所选${sel.length ? ` ${sel.length}` : ''}` : '全部导出'}</span></button>
      </div>

      {facets && (facets.albums.length > 0 || facets.tags.length > 0) && (
        <div className="albums">
          <button className={`chip ${!album ? 'is-on' : ''}`} onClick={() => setAlbum('')}><span>全部</span><em>{facets.favorites}</em></button>
          {facets.albums.map(a => (
            <button key={a.name} className={`chip ${album === a.name ? 'is-on' : ''}`} onClick={() => setAlbum(album === a.name ? '' : a.name)}>
              <FolderOpen size={16} /><span>{a.name}</span><em>{a.count}</em>
            </button>
          ))}
          {facets.tags.length > 0 && <span className="albums-sep" />}
          {facets.tags.map(t => (
            <button key={t.name} className={`chip ${tag === t.name ? 'is-on' : ''}`} onClick={() => setTag(tag === t.name ? '' : t.name)}>#{t.name}</button>
          ))}
        </div>
      )}

      {g.loaded && g.images.length === 0 ? (
        <Empty art="stack" title={filtered ? '没有匹配的资产' : '还没有资产'}  />
      ) : (
        <Justified items={g.images} keyOf={i => i.id} aspect={i => (i.width || 1) / (i.height || 1)}
          render={(img: Img) => <ImageTile img={img} actions={actions} onOpen={() => setLb(g.images.findIndex(x => x.id === img.id))}
            selected={sel.includes(img.id)} onSelect={selecting ? () => toggle(img.id) : undefined} />} />
      )}
      <div ref={sentinel} className="sentinel">{g.loading && g.images.length > 0 && <Spinner />}</div>

      {lb !== null && g.images[lb] && <Lightbox list={g.images} index={lb} onIndex={setLb} onClose={() => setLb(null)} actions={actions}
        albums={(facets?.albums || []).map(a => a.name)} onChange={img => { g.update(img); setTick(t => t + 1) }} />}
    </div>
  )
}
