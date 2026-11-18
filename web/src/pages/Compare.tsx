import { useEffect, useState } from 'react'
import { Plus, X, Columns3, Heart, AlertTriangle, Plug } from 'lucide-react'
import { api, type Img, type Job, type Params } from '../api'
import { useStore, type RefImg } from '../store'
import { Empty, Select, Spinner, useInterval, useNow } from '../components/ui'
import { ParamControls, normalizeParams } from '../components/params'
import { RefDrop } from '../components/refs'
import { Lightbox, useImageActions } from '../components/gallery'
import { describeParams, fmtBytes, fmtDuration, fmtTime, ratioOf } from '../labels'

interface Combo { key: number; channelId: number; model: string; params: Params }
interface Saved { prompt: string; combos: Combo[]; refs: RefImg[]; group: string }

function load(): Saved | null {
  try { const r = localStorage.getItem('studio.compare'); return r ? JSON.parse(r) : null } catch { return null }
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      {sub && <span className="page-sub">{sub}</span>}
      <span className="grow" />
      {children}
    </header>
  )
}

export default function Compare() {
  const { channels, toast, go, bumpGallery, isAdmin, reloadMe } = useStore()
  const saved = load()
  const [prompt, setPrompt] = useState(saved?.prompt || '')
  const [combos, setCombos] = useState<Combo[]>(saved?.combos || [])
  const [refs, setRefs] = useState<RefImg[]>(saved?.refs || [])
  const [group, setGroup] = useState(saved?.group || '')
  const [jobs, setJobs] = useState<Job[]>([])
  const [history, setHistory] = useState<{ group_id: string; prompt: string; count: number; created_at: number }[]>([])
  const [busy, setBusy] = useState(false)
  const [lb, setLb] = useState<number | null>(null)

  useEffect(() => { localStorage.setItem('studio.compare', JSON.stringify({ prompt, combos, refs, group })) }, [prompt, combos, refs, group])

  useEffect(() => {
    if (!channels.length) return
    setCombos(cs => {
      const valid = cs.filter(c => channels.some(ch => ch.id === c.channelId))
      if (valid.length) return valid.map(c => ({ ...c, params: normalizeParams(channels.find(ch => ch.id === c.channelId), c.params) }))
      return channels.slice(0, Math.min(2, channels.length)).map((ch, i) => ({ key: Date.now() + i, channelId: ch.id, model: ch.models[0] || '', params: normalizeParams(ch, { n: 1 }) }))
    })
  }, [channels])

  const loadGroup = async (g: string) => {
    if (!g) return
    const res = await api<{ jobs: Job[] }>(`/api/compare/${g}`)
    setJobs(prev => {
      const was = prev.some(j => j.status === 'running' || j.status === 'queued')
      const now = res.jobs.some(j => j.status === 'running' || j.status === 'queued')
      if (was && !now) bumpGallery()
      return res.jobs
    })
  }
  const loadHistory = () => api<any[]>('/api/compare').then(h => { setHistory(h); if (h.length) setGroup(g => g || h[0].group_id) }).catch(() => {})
  useEffect(() => { loadGroup(group).catch(() => {}); loadHistory() }, [group])
  const active = jobs.some(j => j.status === 'running' || j.status === 'queued')
  useInterval(() => { loadGroup(group).catch(() => {}) }, active ? 1500 : null)

  const refMax = Math.min(4, ...combos.map(c => { const ch = channels.find(x => x.id === c.channelId); return ch && ch.caps.refs?.mode !== 'off' ? ch.caps.refs?.max || 0 : 0 }))

  const start = async () => {
    if (!prompt.trim()) { toast('先写点提示词', 'info'); return }
    if (!combos.length) { toast('至少添加一个组合', 'info'); return }
    setBusy(true)
    try {
      const res = await api<{ group_id: string }>('/api/compare', { body: { prompt, refs: refs.slice(0, Math.max(0, refMax)).map(r => r.id), combos: combos.map(c => ({ channel_id: c.channelId, model: c.model, params: c.params })) } })
      setGroup(res.group_id)
    } catch (e: any) { toast(e.message, 'err') }
    finally { setBusy(false); reloadMe() }
  }

  const upd = (key: number, patch: Partial<Combo>) => setCombos(cs => cs.map(c => (c.key === key ? { ...c, ...patch } : c)))
  const add = () => {
    const ch = channels[combos.length % channels.length]
    setCombos(cs => [...cs, { key: Date.now(), channelId: ch.id, model: ch.models[0] || '', params: normalizeParams(ch, { n: 1 }) }])
  }

  const imgs: Img[] = jobs.flatMap(j => j.images.slice(0, 1))
  const patchImg = (img: Img) => setJobs(js => js.map(j => ({ ...j, images: j.images.map(x => (x.id === img.id ? img : x)) })))
  const actions = useImageActions(patchImg, id => setJobs(js => js.map(j => ({ ...j, images: j.images.filter(x => x.id !== id) }))))

  if (!channels.length) return (
    <div className="page"><PageHead title="对比" /><div className="card card-empty">{isAdmin
      ? <Empty art="plug" title="先接入一个渠道" action={<button className="btn btn-primary" onClick={() => go('settings')}><Plug size={16} />添加渠道</button>} />
      : <Empty art="plug" title="暂无可用模型" text="请联系管理员开通" />}</div></div>
  )

  return (
    <div className="page page-compare">
      <PageHead title="对比">
        {history.length > 0 && (
          <Select className="hist-select" value={group} placeholder="历史对比" onChange={g => setGroup(g)}
            options={history.map(h => ({ value: h.group_id, label: h.prompt.slice(0, 18) + (h.prompt.length > 18 ? '…' : ''), hint: fmtTime(h.created_at) }))} />
        )}
      </PageHead>

      <section className="card cmp-prompt">
        <textarea className="cmp-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="同一段提示词，交给不同组合" rows={3} />
        {refMax > 0 && <div className="cmp-refs"><RefDrop refs={refs} onChange={setRefs} max={refMax} /></div>}
      </section>

      <div className="combos" style={{ ['--cols' as any]: combos.length }}>
        {combos.map((c, i) => {
          const ch = channels.find(x => x.id === c.channelId)
          return (
            <div className="card combo" key={c.key}>
              <div className="combo-head">
                <span className="letter">{String.fromCharCode(65 + i)}</span>
                <span className="combo-name">组合 {String.fromCharCode(65 + i)}</span>
                <span className="grow" />
                {combos.length > 1 && <button className="icon-btn sm" onClick={() => setCombos(cs => cs.filter(x => x.key !== c.key))} aria-label="移除组合"><X size={16} /></button>}
              </div>
              <div className="combo-body">
{isAdmin ? <>
                <div className="prow"><div className="prow-label">渠道</div>
                  <Select size="sm" value={String(c.channelId)} options={channels.map(x => ({ value: String(x.id), label: x.name }))}
                    onChange={v => { const nc = channels.find(x => x.id === Number(v)); upd(c.key, { channelId: Number(v), model: nc?.models[0] || '', params: normalizeParams(nc, c.params) }) }} /></div>
                <div className="prow"><div className="prow-label">模型</div>
                  <Select size="sm" value={c.model} placeholder="未选择模型" options={(ch?.models || []).map(m => ({ value: m, label: m }))} onChange={v => upd(c.key, { model: v })} /></div>
                </> : (
                <div className="prow"><div className="prow-label">模型</div>
                  <Select size="sm" value={String(c.channelId)} placeholder="未选择模型" options={channels.map(x => ({ value: String(x.id), label: x.models[0] || '' }))}
                    onChange={v => { const nc = channels.find(x => x.id === Number(v)); upd(c.key, { channelId: Number(v), model: nc?.models[0] || '', params: normalizeParams(nc, c.params) }) }} /></div>
                )}
                <ParamControls compact size="sm" channel={ch} params={c.params} onChange={p => upd(c.key, { params: p })} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="cmp-actions">
        <button className="btn btn-secondary" onClick={add} disabled={combos.length >= 4}><Plus size={16} />添加组合<span className="btn-count">{combos.length}/4</span></button>
        <span className="grow" />
        <button className="btn btn-primary" onClick={start} disabled={busy || active}>{busy || active ? <Spinner /> : <Columns3 size={16} />}{active ? '对比中' : '开始对比'}</button>
      </div>

      {jobs.length > 0 && (
        <section className="cmp-result">
          <div className="sec-head"><h2>结果</h2><span className="page-sub">{fmtTime(jobs[0].created_at)}</span></div>
          <p className="cmp-ptext" data-clamp title={jobs[0].prompt}>{jobs[0].prompt}</p>
          <div className="cmp-grid" style={{ ['--cols' as any]: jobs.length }}>
            {jobs.map((j, i) => <CmpCell key={j.id} job={j} idx={i} onOpen={() => { const k = imgs.findIndex(x => x.id === j.images[0]?.id); if (k >= 0) setLb(k) }} onFav={img => actions.fav(img)} />)}
          </div>
        </section>
      )}
      {lb !== null && imgs[lb] && <Lightbox list={imgs} index={lb} onIndex={setLb} onClose={() => setLb(null)} actions={actions} onChange={patchImg} />}
    </div>
  )
}

function CmpCell({ job, idx, onOpen, onFav }: { job: Job; idx: number; onOpen: () => void; onFav: (img: Img) => void }) {
  const active = job.status === 'running' || job.status === 'queued'
  const now = useNow(active)
  const img = job.images[0]
  const elapsed = active ? (job.started_at ? now - job.started_at : 0) : job.duration_ms
  const tags = describeParams(job.params || {}).filter(p => p.k !== '张数')
  return (
    <div className="cmp-cell">
      <div className="cmp-cell-head">
        <span className="letter">{String.fromCharCode(65 + idx)}</span>
        <div className="cmp-cell-title">{job.channel_name ? <><b title={job.channel_name}>{job.channel_name}</b><span title={job.model}>{job.model}</span></> : <b title={job.model}>{job.model}</b>}</div>
        {img && <button className={`icon-btn sm ${img.favorite ? 'is-fav' : ''}`} onClick={() => onFav(img)} aria-label="收藏" title={img.favorite ? '取消收藏' : '收藏'}><Heart size={16} fill={img.favorite ? 'currentColor' : 'none'} /></button>}
      </div>
      <div className="cmp-frame">
        {active && <div className="skel-center"><Spinner size={20} /><span className="skel-time">{fmtDuration(elapsed)}</span></div>}
        {job.status === 'done' && img && <img src={img.thumb} alt="" onClick={onOpen} />}
        {job.status === 'failed' && <div className="cmp-fail"><AlertTriangle size={20} /><span data-clamp title={job.error}>{job.error || '生成失败'}</span></div>}
      </div>
      <dl className="cmp-meta">
        <div><dt>耗时</dt><dd>{active ? fmtDuration(elapsed) : fmtDuration(job.duration_ms)}</dd></div>
        <div><dt>实际尺寸</dt><dd>{img ? `${img.width}×${img.height}` : '—'}</dd></div>
        <div><dt>文件大小</dt><dd>{img ? fmtBytes(img.bytes) : '—'}</dd></div>
        <div><dt>格式</dt><dd>{img ? img.format.toUpperCase() : '—'}</dd></div>
      </dl>
      <div className="cmp-tags">
        {tags.map(p => <span key={p.k} className="tag-mini">{p.k} {p.v}</span>)}
        {img && job.params?.aspect && job.params.aspect !== ratioOf(img.width, img.height) && <span className="tag-mini">实出 {ratioOf(img.width, img.height)}</span>}
      </div>
    </div>
  )
}
