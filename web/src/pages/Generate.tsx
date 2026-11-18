import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, RotateCw, Plus, Plug, Trash2, ArrowRight } from 'lucide-react'
import { api, marketImg, type Img, type Job, type MarketPrompt } from '../api'
import { useStore } from '../store'
import { Empty, Spinner, useInterval, useNow } from '../components/ui'
import { ImageTile, Lightbox, useImageActions } from '../components/gallery'
import { useSentinel } from '../components/useImages'
import { Composer } from '../components/composer'
import { useApplyMarket } from '../components/market'
import { PixelField } from '../components/pixel'
import { aspectNumber, fmtDuration } from '../labels'

const PAGE = 30
const isActive = (j: Job) => j.status === 'queued' || j.status === 'running'

export default function Generate() {
  const { channels, channelsLoaded, go, bumpGallery, isAdmin, reloadMe, toast } = useStore()
  const [jobs, setJobs] = useState<Job[]>([])
  const [more, setMore] = useState(true)
  const [sel, setSelState] = useState<number>(() => Number(sessionStorage.getItem('studio.job') || 0))
  const setSel = (id: number) => { sessionStorage.setItem('studio.job', String(id)); setSelState(id) }
  const prevActive = useRef<Set<number>>(new Set())
  const busy = useRef(false)

  // 刷新最新一页，合并到已加载的列表里
  const refresh = async () => {
    const res = await api<{ jobs: Job[] }>(`/api/jobs?limit=${PAGE}`)
    setJobs(old => {
      const fresh = new Map(res.jobs.map(j => [j.id, j]))
      const minId = res.jobs.length ? res.jobs[res.jobs.length - 1].id : 0
      const tail = old.filter(j => j.id < minId && !fresh.has(j.id))
      return [...res.jobs, ...tail]
    })
    if (res.jobs.length < PAGE) setMore(false)
    const active = new Set(res.jobs.filter(isActive).map(j => j.id))
    let finished = false
    prevActive.current.forEach(id => { if (!active.has(id)) finished = true })
    prevActive.current = active
    if (finished) { bumpGallery(); reloadMe() }
  }
  const loadMore = async () => {
    if (busy.current || !more || !jobs.length) return
    busy.current = true
    try {
      const res = await api<{ jobs: Job[] }>(`/api/jobs?limit=${PAGE}&before=${jobs[jobs.length - 1].id}`)
      setJobs(l => [...l, ...res.jobs.filter(j => !l.some(x => x.id === j.id))])
      if (res.jobs.length < PAGE) setMore(false)
    } finally { busy.current = false }
  }
  useEffect(() => { refresh().catch(() => {}) }, [])
  const anyActive = jobs.some(isActive)
  useInterval(() => { refresh().catch(() => {}) }, anyActive ? 1500 : null)
  const sentinel = useSentinel(loadMore, more && jobs.length > 0)

  const onJob = (job: Job) => {
    setJobs(js => [job, ...js])
    prevActive.current.add(job.id)
    setSel(job.id)
  }
  const retry = async (j: Job) => {
    try {
      const job = await api<Job>('/api/jobs', { body: { channel_id: j.channel_id, model: j.model, prompt: j.prompt, params: j.params, refs: j.refs } })
      api(`/api/jobs/${j.id}`, { method: 'DELETE' }).catch(() => {})
      setJobs(js => [job, ...js.filter(x => x.id !== j.id)])
      prevActive.current.add(job.id)
      setSel(job.id)
      reloadMe()
    } catch (e: any) { toast(e.message, 'err') }
  }
  const dropJob = (j: Job) => {
    api(`/api/jobs/${j.id}`, { method: 'DELETE' }).catch(() => {})
    setJobs(js => js.filter(x => x.id !== j.id))
    setSel(0)
  }
  // 结果里的图片被收藏/删除后同步到任务列表
  const patchImg = (img: Img) => setJobs(js => js.map(j => (j.id === img.job_id ? { ...j, images: j.images.map(x => (x.id === img.id ? img : x)) } : j)))
  const removeImg = (id: number) => setJobs(js => js.flatMap(j => {
    if (!j.images.some(x => x.id === id)) return [j]
    const images = j.images.filter(x => x.id !== id)
    if (!images.length && j.status === 'done') { if (j.id === sel) setSel(0); return [] }
    return [{ ...j, images }]
  }))

  const current = jobs.find(j => j.id === sel)
  useEffect(() => { if (sel && jobs.length && !current && !more) setSel(0) }, [sel, jobs.length, current, more])

  if (channelsLoaded && channels.length === 0) {
    return (
      <div className="gen-empty">
        {isAdmin
          ? <Empty art="plug" title="先接入一个渠道" action={<button className="btn btn-primary" onClick={() => go('settings')}><Plug size={16} />添加渠道</button>} />
          : <Empty art="plug" title="暂无可用模型" text="请联系管理员开通" />}
      </div>
    )
  }

  return (
    <div className={`gen gen-split ${jobs.length ? 'has-rail' : ''}`}>
      {jobs.length > 0 && (
        <aside className="rail" aria-label="最近生成">
          <button className={`rail-new ${!current ? 'is-on' : ''}`} onClick={() => setSel(0)} title="新的创作" aria-label="新的创作"><Plus size={20} /></button>
          {jobs.map(j => <RailItem key={j.id} job={j} on={j.id === sel} onClick={() => setSel(j.id)} />)}
          <div ref={sentinel} className="rail-end">{more && <Spinner size={16} />}</div>
          <button className="rail-all" onClick={() => go('assets')} title="打开图库" aria-label="打开图库"><ArrowRight size={16} /></button>
        </aside>
      )}
      <div className="gen-main">
        {current ? <JobView key={current.id} job={current} onRetry={() => retry(current)} onDrop={() => dropJob(current)} onPatch={patchImg} onRemove={removeImg} /> : <Hero />}
      </div>
      <Composer onJob={onJob} />
    </div>
  )
}

function RailItem({ job, on, onClick }: { job: Job; on: boolean; onClick: () => void }) {
  const first = job.images[0]
  const failed = job.status === 'failed'
  return (
    <button className={`rail-item ${on ? 'is-on' : ''} ${failed ? 'is-fail' : ''}`} onClick={onClick} title={job.prompt} aria-label={job.prompt}>
      {first ? <img src={first.thumb} alt="" loading="lazy" draggable={false} />
        : failed ? <AlertTriangle size={18} />
        : <PixelField size="sm" />}
      {isActive(job) && first && <span className="rail-spin"><Spinner size={14} /></span>}
      {job.images.length > 1 && <span className="rail-count">{job.images.length}</span>}
    </button>
  )
}

function JobView({ job, onRetry, onDrop, onPatch, onRemove }: {
  job: Job; onRetry: () => void; onDrop: () => void; onPatch: (img: Img) => void; onRemove: (id: number) => void
}) {
  const [lb, setLb] = useState<number | null>(null)
  const actions = useImageActions(onPatch, onRemove)
  // 打开时仍在生成的任务，之后到达的图片播放揭示动画
  const seen = useRef<Set<number> | null>(null)
  if (seen.current === null) seen.current = isActive(job) ? new Set(job.images.map(i => i.id)) : null
  const [revealed, setRevealed] = useState<number[]>([])
  const fresh = (id: number) => !!seen.current && !seen.current.has(id) && !revealed.includes(id)
  const active = isActive(job)
  const n = Math.max(1, Math.min(job.params?.n || 1, 8))
  const slots = active ? Math.max(0, n - job.images.length) : 0
  const count = job.images.length + slots
  const ar = aspectNumber(job.params?.aspect, job.params?.size)
  useEffect(() => { if (lb !== null && lb >= job.images.length) setLb(job.images.length ? job.images.length - 1 : null) }, [job.images.length])

  return (
    <section className="jv">
      {job.status === 'failed' ? (
        <div className="jv-fail">
          <AlertTriangle size={22} />
          <p className="jv-fail-text">{job.error || '生成失败'}</p>
          <div className="jv-fail-actions">
            <button className="btn btn-primary" onClick={onRetry}><RotateCw size={16} />重试</button>
            <button className="btn btn-secondary" onClick={onDrop}><Trash2 size={16} />移除</button>
          </div>
        </div>
      ) : (
        <div className={`jv-grid c${Math.min(count, 4)}`}>
          {job.images.map((img, i) => (
            <div key={img.id} className="jv-cell" style={{ aspectRatio: `${img.width || 1} / ${img.height || 1}` }}>
              <ImageTile img={img} actions={actions} onOpen={() => setLb(i)} />
              {fresh(img.id) && <div className="reveal-cover"><PixelField src={img.thumb} onDone={() => setRevealed(r => [...r, img.id])} /></div>}
            </div>
          ))}
          {Array.from({ length: slots }, (_, i) => (
            <div key={'s' + i} className="jv-cell" style={{ aspectRatio: String(ar || 1) }}><Pending job={job} /></div>
          ))}
        </div>
      )}
      {lb !== null && job.images[lb] && <Lightbox list={job.images} index={lb} onIndex={setLb} onClose={() => setLb(null)} actions={actions} onChange={onPatch} />}
    </section>
  )
}

function Pending({ job }: { job: Job }) {
  const now = useNow(true)
  const elapsed = job.started_at ? now - job.started_at : 0
  return (
    <div className="tile tile-skel tile-pixel">
      <PixelField />
      <span className="skel-time">{job.status === 'queued' ? '排队中' : fmtDuration(elapsed)}</span>
    </div>
  )
}

let heroCache: MarketPrompt[] | null = null

function Hero() {
  const [items, setItems] = useState<MarketPrompt[]>(heroCache || [])
  const apply = useApplyMarket()
  useEffect(() => { if (!heroCache) api<MarketPrompt[]>('/api/market/hero').then(x => { heroCache = x; setItems(x) }).catch(() => {}) }, [])
  return (
    <section className="hero">
      <h1 className="hero-title">脑海里的画面，<br className="br-sm" />一句话就到眼前。</h1>
      <div className="fan">
        {(items.length ? items : Array.from({ length: 5 }, () => null)).map((p, i) => (
          <button key={p ? p.id : i} className={`fan-card f${i}`} onClick={() => p && apply(p)} disabled={!p} aria-label={p ? `套用：${p.title}` : '示例'}>
            {p && <img src={marketImg(p.preview)} alt="" draggable={false} />}
            {p && <span className="fan-tip">{p.title}</span>}
          </button>
        ))}
      </div>
      <p className="hero-hint">点一张卡片套用它的提示词，再改成你想要的样子</p>
    </section>
  )
}
