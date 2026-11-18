import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCw, X, Plug, ArrowRight, Sparkles } from 'lucide-react'
import { api, marketImg, type Img, type Job, type MarketPrompt } from '../api'
import { useStore } from '../store'
import { Empty, Segmented, Spinner, useInterval, useNow } from '../components/ui'
import { ImageTile, Justified, Lightbox, useImageActions } from '../components/gallery'
import { useImages, useSentinel } from '../components/useImages'
import { Composer } from '../components/composer'
import { useApplyMarket } from '../components/market'
import { aspectNumber, fmtDuration } from '../labels'

type Cell = { kind: 'img'; img: Img } | { kind: 'job'; job: Job; slot: number }

export default function Generate() {
  const { channels, channelsLoaded, go, galleryTick, bumpGallery, genView, setGenView } = useStore()
  const [jobs, setJobs] = useState<Job[]>([])
  const [dismissed, setDismissed] = useState<number[]>(() => JSON.parse(sessionStorage.getItem('studio.dismissed') || '[]'))
  const [favOnly, setFavOnly] = useState(false)
  const prevActive = useRef<Set<number>>(new Set())

  const loadJobs = async () => {
    const res = await api<{ jobs: Job[] }>('/api/jobs?limit=8')
    setJobs(res.jobs)
    const active = new Set(res.jobs.filter(j => j.status === 'queued' || j.status === 'running').map(j => j.id))
    let finished = false
    prevActive.current.forEach(id => { if (!active.has(id)) finished = true })
    prevActive.current = active
    if (finished) bumpGallery()
  }
  useEffect(() => { loadJobs().catch(() => {}) }, [])
  const anyActive = jobs.some(j => j.status === 'queued' || j.status === 'running')
  useInterval(() => { loadJobs().catch(() => {}) }, anyActive ? 1500 : null)
  useEffect(() => { sessionStorage.setItem('studio.dismissed', JSON.stringify(dismissed)) }, [dismissed])

  const onJob = (job: Job) => {
    setJobs(js => [job, ...js])
    prevActive.current.add(job.id)
    setGenView('gallery')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const retry = async (j: Job) => {
    try {
      const job = await api<Job>('/api/jobs', { body: { channel_id: j.channel_id, model: j.model, prompt: j.prompt, params: j.params, refs: j.refs } })
      setJobs(js => [job, ...js.filter(x => x.id !== j.id)])
      prevActive.current.add(job.id)
      api(`/api/jobs/${j.id}`, { method: 'DELETE' }).catch(() => {})
    } catch {}
  }
  const dismiss = (j: Job) => { setDismissed(d => [...d, j.id]); api(`/api/jobs/${j.id}`, { method: 'DELETE' }).catch(() => {}) }

  const hist = useImages(favOnly ? { fav: '1' } : {}, galleryTick)
  const patch = (img: Img) => hist.update(img)
  const actions = useImageActions(img => { if (favOnly && !img.favorite) hist.remove(img.id); else patch(img) }, id => hist.remove(id))
  const sentinel = useSentinel(hist.more, !!hist.next && genView === 'gallery')
  const [lb, setLb] = useState<number | null>(null)
  useEffect(() => { if (lb !== null && lb >= hist.images.length) setLb(hist.images.length ? hist.images.length - 1 : null) }, [hist.images.length])

  // 进行中的任务 + 刚失败的任务，作为骨架/错误格子排在图库最前面
  const have = new Set(hist.images.map(i => i.id))
  const recent = Date.now() - 3600e3
  const pending: Cell[] = favOnly ? [] : jobs.flatMap(j => {
    const active = j.status === 'queued' || j.status === 'running'
    const waiting = j.status === 'done' && j.images.some(i => !have.has(i.id)) && j.finished_at > Date.now() - 15000
    const failed = j.status === 'failed' && j.created_at > recent && !dismissed.includes(j.id)
    if (failed) return [{ kind: 'job' as const, job: j, slot: 0 }]
    if (!active && !waiting) return []
    return Array.from({ length: Math.min(j.params?.n || 1, 4) }, (_, slot) => ({ kind: 'job' as const, job: j, slot }))
  })
  const cells: Cell[] = [...pending, ...hist.images.map(img => ({ kind: 'img' as const, img }))]

  if (channelsLoaded && channels.length === 0) {
    return (
      <div className="gen-empty">
        <Empty art="plug" title="先接入一个渠道" action={<button className="btn btn-primary" onClick={() => go('settings')}><Plug size={16} />添加渠道</button>} />
      </div>
    )
  }

  return (
    <div className="gen">
      {genView === 'hero' ? (
        <Hero count={hist.images.length} more={!!hist.next} onShow={() => setGenView('gallery')} />
      ) : (
        <section className="gen-gallery">
          <div className="gal-head">
            <h1 className="gal-title">作品</h1>
            <span className="gal-count">{hist.next ? `${hist.images.length}+` : hist.images.length} 张</span>
            <span className="grow" />
            <Segmented size="sm" block={false} value={favOnly ? 'fav' : 'all'} onChange={v => setFavOnly(v === 'fav')} options={[{ value: 'all', label: '全部' }, { value: 'fav', label: '已收藏' }]} />
            <button className="btn btn-secondary btn-sm" onClick={() => setGenView('hero')}><Sparkles size={14} />灵感</button>
          </div>
          {hist.loaded && cells.length === 0 ? (
            <Empty art="frame" title={favOnly ? '还没有收藏' : '还没有作品'} />
          ) : (
            <Justified items={cells} keyOf={c => (c.kind === 'img' ? 'i' + c.img.id : `j${c.job.id}-${c.slot}`)}
              aspect={c => (c.kind === 'img' ? (c.img.width || 1) / (c.img.height || 1) : c.job.status === 'failed' ? 1.4 : aspectNumber(c.job.params?.aspect, c.job.params?.size))}
              render={c => c.kind === 'img'
                ? <ImageTile img={c.img} actions={actions} onOpen={() => setLb(hist.images.findIndex(x => x.id === c.img.id))} />
                : <JobTile job={c.job} onRetry={() => retry(c.job)} onDismiss={() => dismiss(c.job)} />} />
          )}
          <div ref={sentinel} className="sentinel">{hist.loading && hist.images.length > 0 && <Spinner />}</div>
        </section>
      )}
      <Composer onJob={onJob} />
      {lb !== null && hist.images[lb] && <Lightbox list={hist.images} index={lb} onIndex={setLb} onClose={() => setLb(null)} actions={actions} onChange={patch} />}
    </div>
  )
}

function JobTile({ job, onRetry, onDismiss }: { job: Job; onRetry: () => void; onDismiss: () => void }) {
  const active = job.status === 'queued' || job.status === 'running'
  const now = useNow(active)
  if (job.status === 'failed') return (
    <div className="tile tile-fail">
      <AlertTriangle size={20} />
      <p className="tile-fail-text" data-clamp title={job.error}>{job.error || '生成失败'}</p>
      <div className="tile-fail-actions">
        <button className="btn btn-secondary btn-sm" onClick={onRetry}><RotateCw size={14} />重试</button>
        <button className="icon-btn sm" onClick={onDismiss} aria-label="关闭"><X size={16} /></button>
      </div>
    </div>
  )
  const elapsed = active && job.started_at ? now - job.started_at : job.duration_ms
  return (
    <div className="tile tile-skel">
      <div className="skel-center">
        <Spinner size={20} />
        <span className="skel-time">{job.status === 'queued' ? '排队中' : fmtDuration(elapsed)}</span>
      </div>
      <span className="skel-model" title={job.model}>{job.model}</span>
    </div>
  )
}

let heroCache: MarketPrompt[] | null = null

function Hero({ count, more, onShow }: { count: number; more: boolean; onShow: () => void }) {
  const [items, setItems] = useState<MarketPrompt[]>(heroCache || [])
  const apply = useApplyMarket()
  useEffect(() => { if (!heroCache) api<MarketPrompt[]>('/api/market/hero').then(x => { heroCache = x; setItems(x) }).catch(() => {}) }, [])
  return (
    <section className="hero">
      <h1 className="hero-title">脑海里的画面，<br className="br-sm" />一句话就到眼前。</h1>
      <div className="fan">
        {(items.length ? items : Array.from({ length: 5 }, () => null)).map((p, i) => (
          <button key={p ? p.id : i} className={`fan-card f${i}`} onClick={() => p && apply(p)} disabled={!p} title={p ? p.title : undefined} aria-label={p ? `套用：${p.title}` : '示例'}>
            {p && <img src={marketImg(p.preview)} alt="" draggable={false} />}
          </button>
        ))}
      </div>
      <p className="hero-hint">点一张卡片套用它的提示词，再改成你想要的样子</p>
      {count > 0 && <button className="btn btn-secondary btn-sm hero-more" onClick={onShow}>查看作品<span className="btn-count">{more ? `${count}+` : count}</span><ArrowRight size={14} /></button>}
    </section>
  )
}
