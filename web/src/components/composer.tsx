import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, BookOpen, Check, ChevronDown, Eraser, Plus, SlidersHorizontal, Settings2, X, Sparkles } from 'lucide-react'
import { api, type Job } from '../api'
import { useStore } from '../store'
import { extractVars } from '../data/snippets'
import { Pop, Spinner } from './ui'
import { ParamControls, normalizeParams, paramSummary } from './params'
import { RefThumbs, useRefUpload } from './refs'

export function Composer({ onJob }: { onJob: (j: Job) => void }) {
  const { channels, composer, setComposer, finalPrompt, toast, openMarket, go, isAdmin, quota, reloadMe } = useStore()
  const channel = channels.find(c => c.id === composer.channelId)
  const [submitting, setSubmitting] = useState(false)
  const [pop, setPop] = useState<'' | 'model' | 'params'>('')
  const [over, setOver] = useState(false)
  const modelRef = useRef<HTMLButtonElement>(null)
  const paramRef = useRef<HTMLButtonElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const dock = useRef<HTMLDivElement>(null)
  const refMax = channel ? (channel.caps.refs?.mode === 'off' ? 0 : channel.caps.refs?.max || 0) : 0
  const up = useRefUpload(composer.refs, refs => setComposer({ refs }), refMax)
  const vars = useMemo(() => extractVars(composer.text), [composer.text])

  // 渠道切换时修正参数
  useEffect(() => {
    if (!channel) return
    const p = normalizeParams(channel, composer.params)
    const model = channel.models.includes(composer.model) ? composer.model : channel.models[0] || ''
    if (JSON.stringify(p) !== JSON.stringify(composer.params) || model !== composer.model) setComposer({ params: p, model })
  }, [channel?.id, channel?.caps])

  // 文本框自动增高
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = Math.min(200, Math.max(40, el.scrollHeight)) + 'px'
  }, [composer.text])

  // 把面板高度写进 CSS 变量，页面据此留白
  useLayoutEffect(() => {
    const el = dock.current
    if (!el) return
    const set = () => document.documentElement.style.setProperty('--dock-h', el.offsetHeight + 'px')
    set()
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => { ro.disconnect(); document.documentElement.style.removeProperty('--dock-h') }
  }, [])

  const submit = async () => {
    if (!channel) { if (isAdmin) { toast('请先添加渠道', 'info'); go('settings') } else toast('暂无可用模型', 'info'); return }
    if (!finalPrompt.trim()) { toast('先写点提示词', 'info'); ta.current?.focus(); return }
    setSubmitting(true)
    try {
      const job = await api<Job>('/api/jobs', { body: { channel_id: channel.id, model: composer.model, prompt: finalPrompt, params: composer.params, refs: composer.refs.slice(0, refMax).map(r => r.id) } })
      onJob(job)
      setPop('')
      reloadMe()
    } catch (e: any) { toast(e.message, 'err'); reloadMe() }
    finally { setSubmitting(false) }
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit() } }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const hasText = !!(composer.text || composer.chips.length)
  return (
    <div className="dock" ref={dock}>
      <div className={`cbar ${over ? 'is-over' : ''}`}
        onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); up.add(Array.from(e.dataTransfer.files)) }}>
        {(composer.refs.length > 0 || up.busy > 0) && (
          <div className="cbar-refs"><RefThumbs refs={composer.refs} busy={up.busy} onChange={refs => setComposer({ refs })} /></div>
        )}
        {composer.chips.length > 0 && (
          <div className="cbar-chips">
            {composer.chips.map(c => (
              <span key={c} className="chip is-picked">{c}
                <button onClick={() => setComposer(s => ({ chips: s.chips.filter(x => x !== c) }))} aria-label="移除"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
        {vars.length > 0 && (
          <div className="cbar-vars">
            {vars.map(v => (
              <label key={v} className="var">
                <span>{v}</span>
                <input value={composer.vars[v] || ''} placeholder={v} onChange={e => setComposer(s => ({ vars: { ...s.vars, [v]: e.target.value } }))} />
              </label>
            ))}
          </div>
        )}
        <div className="cbar-main">
          <button className="cbar-add" onClick={up.pick} aria-label="添加参考图" title={refMax ? `参考图 ${composer.refs.length}/${refMax}` : '当前渠道不支持参考图'} disabled={!refMax}><Plus size={20} /></button>
          <textarea ref={ta} className="cbar-input" rows={1} value={composer.text} placeholder="描述你想要的画面，或添加参考图进行编辑"
            onChange={e => setComposer({ text: e.target.value })} />
        </div>
        <div className="cbar-tools">
          <button ref={modelRef} className={`pill pill-model ${pop === 'model' ? 'is-open' : ''}`} onClick={() => setPop(p => (p === 'model' ? '' : 'model'))}>
            <Sparkles size={14} /><span className="pill-text" title={composer.model}>{composer.model || '选择模型'}</span><ChevronDown size={14} />
          </button>
          <button className="pill" onClick={() => openMarket({ tab: 'market' })}><BookOpen size={14} /><span className="pill-text hide-xs">提示词</span></button>
          <button ref={paramRef} className={`pill ${pop === 'params' ? 'is-open' : ''}`} onClick={() => setPop(p => (p === 'params' ? '' : 'params'))}>
            <SlidersHorizontal size={14} /><span className="pill-text">{paramSummary(channel, composer.params)}</span>
          </button>
          <span className="grow" />
          {quota && !quota.unlimited && <span className={`quota-left ${quota.remaining <= 0 ? 'is-out' : ''}`} title="今日剩余额度">剩 {quota.remaining}</span>}
          {hasText && <button className="icon-btn sm" onClick={() => setComposer({ text: '', chips: [], vars: {} })} aria-label="清空" title="清空"><Eraser size={16} /></button>}
          <button className="send" onClick={submit} disabled={submitting} aria-label="生成" title="生成（⌘↵）">
            {submitting ? <Spinner size={14} /> : <ArrowUp size={18} strokeWidth={2.4} />}
          </button>
        </div>
        {up.fileInput}
      </div>

      <Pop anchor={modelRef} open={pop === 'model'} onClose={() => setPop('')} width={300}>
        <div className={`mpick ${isAdmin ? "" : "is-flat"}`}>
          {channels.map(ch => (
            <div key={ch.id} className="mpick-group">
              {isAdmin && <div className="mpick-head">{ch.name}{ch.hidden ? ' · 仅管理员' : ''}</div>}
              {ch.models.map(m => {
                const sel = composer.channelId === ch.id && composer.model === m
                return (
                  <button key={m} className={`menu-item ${sel ? 'is-on' : ''}`} onClick={() => { setComposer({ channelId: ch.id, model: m }); setPop('') }}>
                    <span className="menu-label" title={m}>{m}</span><Check size={14} className="menu-check" />
                  </button>
                )
              })}
            </div>
          ))}
          {isAdmin && <div className="mpick-foot">
            <button className="menu-item" onClick={() => { setPop(''); go('settings') }}><Settings2 size={14} /><span className="menu-label">管理渠道</span></button>
          </div>}
        </div>
      </Pop>
      <Pop anchor={paramRef} open={pop === 'params'} onClose={() => setPop('')} width={400}>
        <div className="ppick">
          <ParamControls channel={channel} params={composer.params} onChange={params => setComposer({ params })} />
        </div>
      </Pop>
    </div>
  )
}
