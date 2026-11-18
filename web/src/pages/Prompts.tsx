import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Upload, Plus, Search, Pin, Pencil, Trash2, ArrowRight, User, Package, Megaphone, Brush, CircleUser, Smartphone, Hexagon, UtensilsCrossed, Sofa, Swords, BookmarkPlus } from 'lucide-react'
import { api, type PromptItem } from '../api'
import { useStore } from '../store'
import { builtinTemplates, snippetGroups, extractVars } from '../data/snippets'
import { Empty, Modal, Segmented, TagInput } from '../components/ui'
import { PageHead } from './Generate'

const coverIcon: Record<string, any> = { portrait: User, product: Package, poster: Megaphone, illustration: Brush, avatar: CircleUser, wallpaper: Smartphone, logo: Hexagon, food: UtensilsCrossed, interior: Sofa, character: Swords }

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\{[^{}\s]{1,16}\})/g)
  return <>{parts.map((p, i) => (/^\{.*\}$/.test(p) ? <mark key={i} className="var-mark">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>
}

export default function Prompts() {
  const [tab, setTab] = useState<'snip' | 'tpl' | 'mine'>(() => (sessionStorage.getItem('studio.ptab') as any) || 'snip')
  useEffect(() => { sessionStorage.setItem('studio.ptab', tab) }, [tab])
  return (
    <div className="page page-prompts">
      <PageHead title="提示词">
        <Segmented value={tab} onChange={v => setTab(v as any)} options={[{ value: 'snip', label: '片段库' }, { value: 'tpl', label: '精选模板' }, { value: 'mine', label: '我的提示词' }]} />
      </PageHead>
      {tab === 'snip' && <SnippetLib />}
      {tab === 'tpl' && <Templates />}
      {tab === 'mine' && <Mine />}
    </div>
  )
}

function GoBar() {
  const { composer, go } = useStore()
  if (!composer.chips.length) return null
  return (
    <div className="gobar">
      <span>已选 {composer.chips.length} 个片段</span>
      <button className="btn btn-accent sm" onClick={() => go('generate')}>去生成<ArrowRight size={14} /></button>
    </div>
  )
}

function SnippetLib() {
  const { addChip, composer, setComposer } = useStore()
  const [g, setG] = useState(snippetGroups[0].key)
  const [q, setQ] = useState('')
  const groups = q ? snippetGroups.map(x => ({ ...x, items: x.items.filter(it => it.zh.includes(q) || it.en.toLowerCase().includes(q.toLowerCase())) })).filter(x => x.items.length) : snippetGroups.filter(x => x.key === g)
  return (
    <div className="snip-lib">
      <nav className="snip-nav">
        <div className="search"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索片段" /></div>
        {snippetGroups.map(x => (
          <button key={x.key} className={`snip-nav-item ${!q && x.key === g ? 'is-on' : ''}`} onClick={() => { setQ(''); setG(x.key) }}>
            <span>{x.name}</span><em>{x.items.length}</em>
          </button>
        ))}
      </nav>
      <div className="snip-main">
        {groups.length === 0 && <Empty art="book" title="没有匹配的片段" />}
        {groups.map(gr => (
          <section key={gr.key} className="snip-sec">
            <h3 className="snip-h">{gr.name}</h3>
            <div className="snip-grid">
              {gr.items.map(it => {
                const on = composer.chips.includes(it.zh)
                return (
                  <button key={it.zh} className={`snip-card ${on ? 'is-on' : ''}`} onClick={() => (on ? setComposer(s => ({ chips: s.chips.filter(x => x !== it.zh) })) : addChip(it.zh))}>
                    <span className="snip-zh">{it.zh}</span>
                    <span className="snip-en">{it.en}</span>
                    <span className="snip-plus">{on ? '已加入' : '加入'}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      <GoBar />
    </div>
  )
}

function Templates() {
  const { setComposer, go, toast } = useStore()
  const use = (content: string) => { setComposer({ text: content, chips: [], vars: {} }); go('generate') }
  const saveMine = async (t: typeof builtinTemplates[number]) => {
    await api('/api/prompts', { body: { title: t.name, content: t.content, tags: t.tags, is_template: true } })
    toast('已存入我的提示词')
  }
  return (
    <div className="tpl-grid">
      {builtinTemplates.map((t, i) => {
        const Icon = coverIcon[t.cover] || Brush
        return (
          <article key={t.key} className={`card tpl tone-${i % 5}`}>
            <div className="tpl-cover"><Icon size={26} strokeWidth={1.6} /><span className="tpl-vars">{extractVars(t.content).length} 个变量</span></div>
            <div className="tpl-body">
              <h3>{t.name}</h3>
              <p><Highlight text={t.content} /></p>
            </div>
            <div className="tpl-foot">
              {t.tags.map(x => <span key={x} className="mini-tag">{x}</span>)}
              <span className="grow" />
              <button className="icon-btn sm" title="存入我的提示词" aria-label="存入我的提示词" onClick={() => saveMine(t)}><BookmarkPlus size={15} /></button>
              <button className="btn btn-ghost sm" onClick={() => use(t.content)}>使用<ArrowRight size={14} /></button>
            </div>
          </article>
        )
      })}
    </div>
  )
}

function Mine() {
  const { setComposer, go, toast } = useStore()
  const [list, setList] = useState<PromptItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [edit, setEdit] = useState<Partial<PromptItem> | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const reload = () => api<PromptItem[]>('/api/prompts').then(l => { setList(l); setLoaded(true) })
  useEffect(() => { reload().catch(() => setLoaded(true)) }, [])
  const tags = useMemo(() => Array.from(new Set(list.flatMap(p => p.tags))), [list])
  const shown = list.filter(p => (!tag || p.tags.includes(tag)) && (!q || p.title.includes(q) || p.content.includes(q) || p.tags.some(t => t.includes(q))))

  const use = (p: PromptItem) => { setComposer({ text: p.content, chips: [], vars: {} }); api(`/api/prompts/${p.id}/use`, { method: 'POST' }).catch(() => {}); go('generate') }
  const pin = async (p: PromptItem) => { await api(`/api/prompts/${p.id}`, { method: 'PUT', body: { ...p, pinned: !p.pinned } }); reload() }
  const del = async (p: PromptItem) => { if (!confirm(`删除「${p.title}」？`)) return; await api(`/api/prompts/${p.id}`, { method: 'DELETE' }); reload(); toast('已删除') }
  const save = async () => {
    if (!edit?.content?.trim()) { toast('内容不能为空', 'info'); return }
    try {
      await api(edit.id ? `/api/prompts/${edit.id}` : '/api/prompts', { method: edit.id ? 'PUT' : 'POST', body: { ...edit, tags: edit.tags || [] } })
      setEdit(null); reload(); toast('已保存')
    } catch (e: any) { toast(e.message, 'err') }
  }
  const doImport = async (f: File) => {
    try {
      const data = JSON.parse(await f.text())
      const prompts = Array.isArray(data) ? data : data.prompts
      const res = await api<{ added: number; skipped: number }>('/api/prompts/import', { body: { prompts } })
      toast(`导入 ${res.added} 条${res.skipped ? `，跳过 ${res.skipped} 条重复` : ''}`)
      reload()
    } catch { toast('文件格式不正确', 'err') }
  }

  return (
    <div className="mine">
      <div className="toolbar">
        <div className="search grow"><Search size={15} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索标题、内容或标签" /></div>
        <button className="btn btn-ghost" onClick={() => file.current?.click()}><Upload size={15} /><span className="hide-sm">导入</span></button>
        <a className="btn btn-ghost" href="/api/prompts/export"><Download size={15} /><span className="hide-sm">导出</span></a>
        <button className="btn btn-accent" onClick={() => setEdit({ title: '', content: '', tags: [] })}><Plus size={15} />新建</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
      </div>
      {tags.length > 0 && (
        <div className="tagbar">
          <button className={`chip ${!tag ? 'is-on' : ''}`} onClick={() => setTag('')}>全部</button>
          {tags.map(t => <button key={t} className={`chip ${tag === t ? 'is-on' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>{t}</button>)}
        </div>
      )}
      {loaded && shown.length === 0 && <Empty art="book" title={list.length ? '没有匹配的提示词' : '还没有保存的提示词'} text={list.length ? undefined : '在生成页写好的提示词可以一键存进来'} />}
      <div className="mine-grid">
        {shown.map(p => (
          <article key={p.id} className={`card pcard ${p.pinned ? 'is-pinned' : ''}`}>
            <div className="pcard-head">
              <h3>{p.title}</h3>
              {p.is_template && <span className="badge">模板</span>}
              <span className="grow" />
              <button className={`icon-btn sm ${p.pinned ? 'is-on' : ''}`} onClick={() => pin(p)} title={p.pinned ? '取消置顶' : '置顶'} aria-label="置顶"><Pin size={14} /></button>
            </div>
            <p className="pcard-content"><Highlight text={p.content} /></p>
            <div className="pcard-foot">
              {p.tags.map(t => <span key={t} className="mini-tag">{t}</span>)}
              <span className="grow" />
              <span className="pcard-uses">用过 {p.use_count} 次</span>
            </div>
            <div className="pcard-actions">
              <button className="btn btn-ghost sm" onClick={() => use(p)}>使用<ArrowRight size={14} /></button>
              <span className="grow" />
              <button className="icon-btn sm" onClick={() => setEdit(p)} aria-label="编辑" title="编辑"><Pencil size={14} /></button>
              <button className="icon-btn sm danger" onClick={() => del(p)} aria-label="删除" title="删除"><Trash2 size={14} /></button>
            </div>
          </article>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '编辑提示词' : '新建提示词'}
        footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>取消</button><button className="btn btn-accent" onClick={save}>保存</button></>}>
        {edit && <>
          <label className="field"><span className="field-label">标题</span><input className="input" value={edit.title || ''} onChange={e => setEdit({ ...edit, title: e.target.value })} placeholder="留空则取内容开头" /></label>
          <label className="field"><span className="field-label">内容</span><textarea className="input" rows={6} value={edit.content || ''} onChange={e => setEdit({ ...edit, content: e.target.value })} placeholder="可用 {角色}、{场景} 这样的变量" /></label>
          <label className="field"><span className="field-label">标签</span><TagInput value={edit.tags || []} onChange={tags => setEdit({ ...edit, tags })} /></label>
        </>}
      </Modal>
    </div>
  )
}
