import { useEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, Eraser, Library, Sparkles, X, AlertTriangle, RotateCw, Wand2, Plug, ChevronDown } from 'lucide-react'
import { api, type Img, type Job, type PromptItem } from '../api'
import { useStore, buildPrompt } from '../store'
import { snippetGroups, extractVars } from '../data/snippets'
import { Empty, Masonry, Modal, Select, Spinner, TagInput, useInterval, useNow } from '../components/ui'
import { ParamControls, normalizeParams } from '../components/params'
import { RefDrop } from '../components/refs'
import { ImageTile, Lightbox, useImageActions } from '../components/gallery'
import { useImages, useSentinel } from '../components/useImages'
import { aspectNumber, describeParams, fmtDuration, fmtTime } from '../labels'

export default function Generate() {
  const { channels, channelsLoaded, composer, setComposer, finalPrompt, toast, go, galleryTick, bumpGallery } = useStore()
  const channel = channels.find(c => c.id === composer.channelId)
  const [jobs, setJobs] = useState<Job[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [showSnip, setShowSnip] = useState(false)
  const [pickMine, setPickMine] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [showParams, setShowParams] = useState(false)
  const prevActive = useRef<Set<number>>(new Set())

  // 渠道切换时修正参数
  useEffect(() => {
    if (!channel) return
    const p = normalizeParams(channel, composer.params)
    const model = channel.models.includes(composer.model) ? composer.model : channel.models[0] || ''
    if (JSON.stringify(p) !== JSON.stringify(composer.params) || model !== composer.model) setComposer({ params: p, model })
  }, [channel?.id, channel?.caps])

  const loadJobs = async () => {
    const res = await api<{ jobs: Job[] }>('/api/jobs?limit=6')
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

  const vars = useMemo(() => extractVars(composer.text), [composer.text])
  const refMax = channel ? (channel.caps.refs?.mode === 'off' ? 0 : channel.caps.refs?.max || 0) : 0

  const submit = async () => {
    if (!channel) { toast('请先添加渠道', 'info'); return }
    if (!finalPrompt.trim()) { toast('先写点提示词', 'info'); return }
    setSubmitting(true)
    try {
      const job = await api<Job>('/api/jobs', { body: { channel_id: channel.id, model: composer.model, prompt: finalPrompt, params: composer.params, refs: composer.refs.slice(0, refMax).map(r => r.id) } })
      setJobs(js => [job, ...js].slice(0, 6))
      prevActive.current.add(job.id)
      setShowParams(false)
    } catch (e: any) { toast(e.message, 'err') }
    finally { setSubmitting(false) }
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const retry = async (j: Job) => {
    try {
      const job = await api<Job>('/api/jobs', { body: { channel_id: j.channel_id, model: j.model, prompt: j.prompt, params: j.params, refs: j.refs } })
      setJobs(js => [job, ...js.filter(x => x.id !== j.id)].slice(0, 6))
      prevActive.current.add(job.id)
      api(`/api/jobs/${j.id}`, { method: 'DELETE' }).catch(() => {})
    } catch (e: any) { toast(e.message, 'err') }
  }
  const dismiss = async (j: Job) => {
    setJobs(js => js.filter(x => x.id !== j.id))
    if (j.status === 'failed') api(`/api/jobs/${j.id}`, { method: 'DELETE' }).catch(() => {})
  }

  // 历史
  const hist = useImages({}, galleryTick)
  const actions = useImageActions(img => patchEverywhere(img),
    id => { hist.remove(id); setJobs(js => js.map(j => ({ ...j, images: j.images.filter(x => x.id !== id) }))) })
  const sentinel = useSentinel(hist.more, !!hist.next)
  const [lb, setLb] = useState<{ job?: number; i: number } | null>(null)
  const lbList: Img[] = lb ? (lb.job ? jobs.find(j => j.id === lb.job)?.images || [] : hist.images) : []
  useEffect(() => { if (lb && lb.i >= lbList.length) lbList.length ? setLb({ ...lb, i: lbList.length - 1 }) : setLb(null) }, [lbList.length])
  const patchEverywhere = (img: Img) => { hist.update(img); setJobs(js => js.map(j => ({ ...j, images: j.images.map(x => (x.id === img.id ? img : x)) }))) }

  if (channelsLoaded && channels.length === 0) {
    return (
      <div className="page">
        <PageHead title="生成" />
        <div className="card onboarding">
          <Empty art="plug" title="先接入一个渠道" action={<button className="btn btn-accent" onClick={() => go('settings')}><Plug size={16} />添加渠道</button>} />
        </div>
      </div>
    )
  }

  const visibleJobs = jobs.filter(j => Date.now() - j.created_at < 6 * 3600e3 || j.status === 'running' || j.status === 'queued')

  return (
    <div className="page page-gen">
      <PageHead title="生成" />
      <div className="gen-grid">
        <section className="card composer">
          <div className="composer-body">
            <textarea className="prompt-input" value={composer.text} placeholder="描述你想要的画面……"
              onChange={e => setComposer({ text: e.target.value })} rows={6} />
            {composer.chips.length > 0 && (
              <div className="chips">
                {composer.chips.map(c => (
                  <span key={c} className="chip is-picked">{c}
                    <button onClick={() => setComposer(s => ({ chips: s.chips.filter(x => x !== c) }))} aria-label="移除"><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            {vars.length > 0 && (
              <div className="vars">
                {vars.map(v => (
                  <label key={v} className="var">
                    <span>{v}</span>
                    <input value={composer.vars[v] || ''} placeholder={`填写${v}`} onChange={e => setComposer(s => ({ vars: { ...s.vars, [v]: e.target.value } }))} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="composer-tools">
            <button className={`tool ${showSnip ? 'is-on' : ''}`} onClick={() => setShowSnip(s => !s)}><Sparkles size={15} />灵感片段</button>
            <button className="tool" onClick={() => setPickMine(true)}><Library size={15} />我的提示词</button>
            <button className="tool" onClick={() => finalPrompt.trim() ? setSaveOpen(true) : toast('先写点提示词', 'info')}><BookmarkPlus size={15} />存为提示词</button>
            <span className="grow" />
            <span className="count">{finalPrompt.length} 字</span>
            {(composer.text || composer.chips.length > 0) && (
              <button className="tool is-quiet" onClick={() => setComposer({ text: '', chips: [], vars: {} })} title="清空"><Eraser size={15} /></button>
            )}
          </div>
          {showSnip && <SnippetPanel />}
          <div className="composer-refs">
            <RefDrop refs={composer.refs} max={refMax} onChange={refs => setComposer({ refs })} />
          </div>
        </section>

        <aside className={`card panel ${showParams ? 'is-open' : ''}`}>
          <div className="panel-sel">
            <label className="field">
              <span className="field-label">渠道</span>
              <Select value={String(composer.channelId ?? '')} options={channels.map(c => ({ value: String(c.id), label: c.name }))}
                onChange={v => { const ch = channels.find(c => c.id === Number(v)); setComposer({ channelId: Number(v), model: ch?.models[0] || '' }) }} />
            </label>
            <label className="field">
              <span className="field-label">模型</span>
              <Select value={composer.model} placeholder="未选择模型" options={(channel?.models || []).map(m => ({ value: m, label: m }))} onChange={v => setComposer({ model: v })} />
            </label>
          </div>
          <button className="panel-toggle" onClick={() => setShowParams(s => !s)}>
            <span>参数</span><span className="panel-sum">{describeParams(composer.params).map(p => p.v).join(' · ')}</span><ChevronDown size={16} />
          </button>
          <div className="panel-params">
            <ParamControls channel={channel} params={composer.params} onChange={params => setComposer({ params })} />
          </div>
          <button className="btn btn-accent btn-go" onClick={submit} disabled={submitting || !channel}>
            {submitting ? <Spinner /> : <Wand2 size={18} />}<span>生成</span><kbd>⌘ ↵</kbd>
          </button>
        </aside>
      </div>

      {visibleJobs.length > 0 && (
        <section className="sec">
          <div className="sec-head"><h2>本次</h2></div>
          <div className="jobs">
            {visibleJobs.map(j => <JobCard key={j.id} job={j} onRetry={() => retry(j)} onDismiss={() => dismiss(j)} actions={actions}
              onOpen={(i) => setLb({ job: j.id, i })} />)}
          </div>
        </section>
      )}

      <section className="sec">
        <div className="sec-head"><h2>历史</h2>{hist.images.length > 0 && <span className="sec-sub">{hist.next ? `${hist.images.length}+` : hist.images.length} 张</span>}</div>
        {hist.loaded && hist.images.length === 0 ? (
          <Empty art="frame" title="还没有作品" text="生成的图片会按时间排在这里" />
        ) : (
          <Masonry items={hist.images} keyOf={i => i.id} aspect={i => (i.width || 1) / (i.height || 1)}
            render={img => <ImageTile img={img} actions={actions} onOpen={() => setLb({ i: hist.images.findIndex(x => x.id === img.id) })} />} />
        )}
        <div ref={sentinel} className="sentinel">{hist.loading && hist.images.length > 0 && <Spinner />}</div>
      </section>

      {lb && lbList.length > 0 && <Lightbox list={lbList} index={Math.min(lb.i, lbList.length - 1)} onIndex={i => setLb({ ...lb, i })} onClose={() => setLb(null)} actions={actions}
        onChange={patchEverywhere} />}

      <PickMine open={pickMine} onClose={() => setPickMine(false)} />
      <SavePrompt open={saveOpen} onClose={() => setSaveOpen(false)} />
    </div>
  )
}

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="page-head">
      <h1>{title}</h1>
      <div className="page-head-extra">{children}</div>
    </header>
  )
}

function JobCard({ job, onRetry, onDismiss, actions, onOpen }: { job: Job; onRetry: () => void; onDismiss: () => void; actions: ReturnType<typeof useImageActions>; onOpen: (i: number) => void }) {
  const active = job.status === 'queued' || job.status === 'running'
  const nowMs = useNow(active)
  const n = job.params?.n || 1
  const ar = aspectNumber(job.params?.aspect, job.params?.size)
  const elapsed = active ? (job.started_at ? nowMs - job.started_at : 0) : job.duration_ms
  return (
    <div className={`job is-${job.status}`}>
      <div className="job-head">
        <span className={`dot is-${job.status}`} />
        <span className="job-ch">{job.channel_name}</span>
        <span className="job-model">{job.model}</span>
        <span className="grow" />
        <span className="job-time mono">{job.status === 'queued' ? '排队中' : fmtDuration(elapsed)}</span>
        {!active && <button className="icon-btn sm" onClick={onDismiss} aria-label="收起"><X size={14} /></button>}
      </div>
      <p className="job-prompt" title={job.prompt}>{job.prompt}</p>
      {active && (
        <div className="job-imgs">
          {Array.from({ length: Math.min(n, 4) }).map((_, i) => (
            <div key={i} className="skeleton" style={{ aspectRatio: String(ar) }}><span className="skeleton-time mono">{(elapsed / 1000).toFixed(1)}s</span></div>
          ))}
        </div>
      )}
      {job.status === 'done' && (
        <div className="job-imgs">
          {job.images.map((img, i) => <ImageTile key={img.id} img={img} actions={actions} onOpen={() => onOpen(i)} />)}
          {job.images.length === 0 && <div className="job-gone">图片已删除</div>}
        </div>
      )}
      {job.status === 'failed' && (
        <div className="job-err">
          <AlertTriangle size={16} />
          <span>{job.error || '生成失败'}</span>
          <button className="btn btn-ghost sm" onClick={onRetry}><RotateCw size={14} />重试</button>
        </div>
      )}
      {job.status === 'done' && job.error && <div className="job-warn">{job.error}</div>}
      <div className="job-foot">{fmtTime(job.created_at)}</div>
    </div>
  )
}

function SnippetPanel() {
  const { addChip, composer, setComposer } = useStore()
  const [g, setG] = useState(snippetGroups[0].key)
  const group = snippetGroups.find(x => x.key === g)!
  return (
    <div className="snip">
      <div className="snip-tabs">
        {snippetGroups.map(x => <button key={x.key} className={`snip-tab ${x.key === g ? 'is-on' : ''}`} onClick={() => setG(x.key)}>{x.name}</button>)}
      </div>
      <div className="snip-items">
        {group.items.map(it => {
          const picked = composer.chips.includes(it.zh)
          return (
            <button key={it.zh} className={`chip ${picked ? 'is-on' : ''}`} title={it.en}
              onClick={() => picked ? setComposer(s => ({ chips: s.chips.filter(x => x !== it.zh) })) : addChip(it.zh)}>
              {it.zh}<em>{it.en}</em>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PickMine({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { setComposer, go } = useStore()
  const [list, setList] = useState<PromptItem[]>([])
  const [q, setQ] = useState('')
  useEffect(() => { if (open) api<PromptItem[]>('/api/prompts').then(setList).catch(() => {}) }, [open])
  const shown = list.filter(p => !q || p.title.includes(q) || p.content.includes(q) || p.tags.some(t => t.includes(q)))
  return (
    <Modal open={open} onClose={onClose} title="我的提示词">
      <input className="input" placeholder="搜索标题、内容或标签" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      <div className="pick-list">
        {shown.length === 0 && <Empty art="book" title={list.length ? '没有匹配的提示词' : '还没有保存的提示词'} action={!list.length ? <button className="btn btn-ghost" onClick={() => { onClose(); go('prompts') }}>去提示词库</button> : undefined} />}
        {shown.map(p => (
          <button key={p.id} className="pick" onClick={() => {
            setComposer({ text: p.content, chips: [], vars: {} })
            api(`/api/prompts/${p.id}/use`, { method: 'POST' }).catch(() => {})
            onClose()
          }}>
            <span className="pick-title">{p.pinned && <i className="pin-dot" />}{p.title}{p.is_template && <span className="badge">模板</span>}</span>
            <span className="pick-content">{p.content}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

function SavePrompt({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { composer, toast } = useStore()
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [asTpl, setAsTpl] = useState(true)
  const hasVars = extractVars(composer.text).length > 0
  const content = hasVars && asTpl ? buildPrompt({ ...composer, vars: {} }) : buildPrompt(composer)
  useEffect(() => { if (open) { setTitle(''); setTags([]) } }, [open])
  const save = async () => {
    try {
      await api('/api/prompts', { body: { title, content, tags, is_template: hasVars && asTpl } })
      toast('已存入我的提示词')
      onClose()
    } catch (e: any) { toast(e.message, 'err') }
  }
  return (
    <Modal open={open} onClose={onClose} title="存为提示词" footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-accent" onClick={save}>保存</button></>}>
      <label className="field"><span className="field-label">标题</span><input className="input" value={title} onChange={e => setTitle(e.target.value)} placeholder="留空则取内容开头" autoFocus /></label>
      <label className="field"><span className="field-label">标签</span><TagInput value={tags} onChange={setTags} /></label>
      {hasVars && (
        <div className="field">
          <span className="field-label">保存方式</span>
          <div className="seg seg-md">
            <button className={`seg-item ${asTpl ? 'is-on' : ''}`} onClick={() => setAsTpl(true)}>保留变量（模板）</button>
            <button className={`seg-item ${!asTpl ? 'is-on' : ''}`} onClick={() => setAsTpl(false)}>填好的成品</button>
          </div>
        </div>
      )}
      <div className="field"><span className="field-label">内容</span><p className="preview-text">{content}</p></div>
    </Modal>
  )
}
