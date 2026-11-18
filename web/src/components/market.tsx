import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Search, X, Star, ExternalLink, RefreshCw, Plus, Upload, Download, Pin, Pencil, Trash2, BookmarkPlus,
  User, Package, Megaphone, Brush, CircleUser, Smartphone, Hexagon, UtensilsCrossed, Sofa, Swords, ImageOff,
} from 'lucide-react'
import { api, marketImg, type MarketPrompt, type MarketState, type PromptItem } from '../api'
import { useStore, type MarketOpen, buildPrompt } from '../store'
import { builtinTemplates, snippetGroups } from '../data/snippets'
import { Empty, Modal, Segmented, Select, Spinner, TagInput } from './ui'
import { useSentinel } from './useImages'
import { fmtTime } from '../labels'

type Lang = 'zh-CN' | 'en'
const sourceShort: Record<string, string> = { 'banana-prompt-quicker': 'banana-prompt-quicker', 'awesome-gpt-image-2-prompts': 'awesome-gpt-image-2-prompts' }

export function localize(p: MarketPrompt, lang: Lang) {
  const l = p.l10n?.[lang] || p.l10n?.['zh-CN'] || p.l10n?.en
  return l ? { ...p, title: l.title, prompt: l.prompt, category: l.category, sub_category: l.sub_category } : p
}

/** 套用市场条目：填入提示词；编辑类条目同时载入参考图 */
export function useApplyMarket() {
  const { setComposer, toast, closeMarket, go } = useStore()
  return async (p: MarketPrompt, lang: Lang = 'zh-CN') => {
    const lp = localize(p, lang)
    setComposer({ text: lp.prompt, chips: [], vars: {}, ...(p.mode === 'edit' ? {} : { refs: [] }) })
    closeMarket()
    go('generate')
    if (p.mode === 'edit') {
      const urls = Array.from(new Set((p.ref_urls && p.ref_urls.length ? p.ref_urls : [p.preview]).filter(Boolean))).slice(0, 4)
      toast('正在载入参考图', 'info')
      const refs: { id: number; url: string }[] = []
      for (const u of urls) {
        try { refs.push(await api('/api/refs/url', { body: { url: u } })) } catch {}
      }
      setComposer({ refs })
      toast(refs.length ? `已套用，载入 ${refs.length} 张参考图` : '已套用，参考图载入失败', refs.length ? 'ok' : 'err')
    } else toast('已套用提示词')
  }
}

export function PromptMarket() {
  const { market, openMarket, closeMarket } = useStore()
  useEffect(() => {
    if (!market) return
    document.body.classList.add('no-scroll')
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.modal-back') && closeMarket()
    window.addEventListener('keydown', esc)
    return () => { document.body.classList.remove('no-scroll'); window.removeEventListener('keydown', esc) }
  }, [!!market])
  if (!market) return null
  const tab = market.tab || 'market'
  const setTab = (t: MarketOpen['tab']) => openMarket({ ...market, tab: t })
  return createPortal(
    <div className="mk-back" onMouseDown={e => e.target === e.currentTarget && closeMarket()}>
      <div className="mk" role="dialog" aria-modal="true">
        <header className="mk-head">
          <h2>提示词</h2>
          <Segmented block={false} value={tab} onChange={v => setTab(v as any)}
            options={[{ value: 'market', label: '市场' }, { value: 'favs', label: '收藏' }, { value: 'mine', label: '我的' }, { value: 'snip', label: '片段' }]} />
          <span className="grow" />
          <button className="icon-btn" onClick={closeMarket} aria-label="关闭"><X size={20} /></button>
        </header>
        {(tab === 'market' || tab === 'favs') && <MarketTab favsOnly={tab === 'favs'} />}
        {tab === 'mine' && <MineTab />}
        {tab === 'snip' && <SnipTab />}
      </div>
    </div>, document.body)
}

// ---------------- 市场 ----------------
let cache: MarketState | null = null

function MarketTab({ favsOnly }: { favsOnly: boolean }) {
  const { toast } = useStore()
  const apply = useApplyMarket()
  const [state, setState] = useState<MarketState | null>(cache)
  const [favs, setFavs] = useState<MarketPrompt[]>([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [source, setSource] = useState('')
  const [lang, setLang] = useState<Lang>('zh-CN')
  const [cat, setCat] = useState('')
  const [mode, setMode] = useState('')
  const [nsfw, setNsfw] = useState('safe')
  const [count, setCount] = useState(48)
  const scroller = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!cache) api<MarketState>('/api/market').then(s => { cache = s; setState(s) }).catch(e => setErr(e.message))
    api<MarketPrompt[]>('/api/market/favs').then(setFavs).catch(() => {})
  }, [])
  const refresh = async () => {
    setBusy(true)
    try { const s = await api<MarketState>('/api/market/refresh', { method: 'POST' }); cache = s; setState(s); toast(`已更新 ${s.items.length} 条`) }
    catch (e: any) { toast(e.message, 'err') }
    finally { setBusy(false) }
  }
  const favIds = useMemo(() => new Set(favs.map(f => f.id)), [favs])
  const toggleFav = async (p: MarketPrompt) => {
    if (favIds.has(p.id)) {
      await api('/api/market/favs/delete', { body: { id: p.id } })
      setFavs(f => f.filter(x => x.id !== p.id))
    } else {
      await api('/api/market/favs', { body: { id: p.id } })
      setFavs(f => [p, ...f])
    }
  }

  const pool = favsOnly ? favs : state?.items || []
  const bySource = source ? pool.filter(p => p.source === source) : pool
  const cats = useMemo(() => Array.from(new Set(bySource.map(p => localize(p, lang).category))).sort((a, b) => a.localeCompare(b, 'zh-CN')), [bySource, lang])
  useEffect(() => { if (cat && !cats.includes(cat)) setCat('') }, [cats])
  const kw = q.trim().toLowerCase()
  const shown = bySource.filter(p => {
    const l = localize(p, lang)
    if (nsfw === 'safe' && p.nsfw) return false
    if (nsfw === 'only' && !p.nsfw) return false
    if (cat && l.category !== cat) return false
    if (mode && p.mode !== mode) return false
    if (!kw) return true
    return [l.title, l.prompt, p.author, l.category, l.sub_category].some(x => x && x.toLowerCase().includes(kw))
  })
  useEffect(() => { setCount(48); scroller.current?.scrollTo({ top: 0 }) }, [q, source, lang, cat, mode, nsfw, favsOnly])
  const sentinel = useSentinel(() => setCount(c => c + 48), count < shown.length)

  return (
    <>
      <div className="mk-filters">
        <div className="search mk-search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索标题、作者、分类或提示词" /></div>
        <Select value={source} onChange={setSource} options={[{ value: '', label: '全部来源' }, ...(state?.sources || []).map(s => ({ value: s.id, label: sourceShort[s.id] || s.label }))]} />
        <Select value={lang} onChange={v => setLang(v as Lang)} options={[{ value: 'zh-CN', label: '中文' }, { value: 'en', label: 'English' }]} />
        <Select value={cat} onChange={setCat} options={[{ value: '', label: '全部分类' }, ...cats.map(c => ({ value: c, label: c }))]} />
        <Select value={mode} onChange={setMode} options={[{ value: '', label: '全部模式' }, { value: 'generate', label: '文生图' }, { value: 'edit', label: '编辑' }]} />
        <Select value={nsfw} onChange={setNsfw} options={[{ value: 'safe', label: '安全内容' }, { value: 'include', label: '含 NSFW' }, { value: 'only', label: '仅 NSFW' }]} />
      </div>
      <div className="mk-credit">
        <span className="mk-count">{shown.length} / {pool.length}</span>
        <span className="mk-src">来自 {(state?.sources || []).map((s, i) => <span key={s.id}>{i > 0 && ' 和 '}<a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>)}</span>
        <span className="grow" />
        {state?.fetched_at ? <span className="mk-time">更新于 {fmtTime(state.fetched_at)}</span> : null}
        {!favsOnly && <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={busy}>{busy ? <Spinner size={14} /> : <RefreshCw size={14} />}刷新</button>}
      </div>
      <div className="mk-scroll" ref={scroller}>
        {!state && !err && !favsOnly && <div className="mk-loading"><Spinner size={20} /></div>}
        {err && !favsOnly && <Empty art="book" title="提示词市场读取失败" text={err} action={<button className="btn btn-secondary" onClick={refresh}><RefreshCw size={16} />重试</button>} />}
        {(state || favsOnly) && shown.length === 0 && <Empty art="book" title={favsOnly && !favs.length ? '还没有收藏' : '没有匹配的提示词'} />}
        <div className="mk-grid">
          {shown.slice(0, count).map(p => <MarketCard key={p.id} p={localize(p, lang)} fav={favIds.has(p.id)} onFav={() => toggleFav(p)} onApply={() => apply(p, lang)} />)}
        </div>
        <div ref={sentinel} className="sentinel" />
      </div>
    </>
  )
}

function MarketCard({ p, fav, onFav, onApply }: { p: MarketPrompt; fav: boolean; onFav: () => void; onApply: () => void }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  return (
    <article className="mcard">
      <div className="mcard-img" onClick={onApply}>
        {failed ? <div className="mcard-noimg"><ImageOff size={20} /></div>
          : <img src={marketImg(p.preview)} alt="" loading="lazy" className={loaded ? 'is-loaded' : ''} onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />}
        <span className="mcard-badges"><span className="badge-img">{p.mode === 'edit' ? '编辑' : '文生图'}</span>{p.nsfw && <span className="badge-img">NSFW</span>}</span>
      </div>
      <div className="mcard-body">
        <h4 className="mcard-title" title={p.title}>{p.title}</h4>
        <div className="mcard-meta" title={`${p.author} · ${p.category}`}>{p.author.startsWith('@') ? p.author : '@' + p.author} · {p.category}{p.sub_category ? ` / ${p.sub_category}` : ''}</div>
        <p className="mcard-text" data-clamp>{p.prompt}</p>
      </div>
      <div className="mcard-foot">
        <button className={`icon-btn sm ${fav ? 'is-star' : ''}`} onClick={onFav} aria-label={fav ? '取消收藏' : '收藏'} title={fav ? '取消收藏' : '收藏'}><Star size={16} fill={fav ? 'currentColor' : 'none'} /></button>
        {p.link && <a className="icon-btn sm" href={p.link} target="_blank" rel="noreferrer" aria-label="查看原帖" title="查看原帖"><ExternalLink size={16} /></a>}
        <span className="grow" />
        <button className="btn btn-primary btn-sm" onClick={onApply}>套用</button>
      </div>
    </article>
  )
}

// ---------------- 我的 ----------------
const coverIcon: Record<string, any> = { portrait: User, product: Package, poster: Megaphone, illustration: Brush, avatar: CircleUser, wallpaper: Smartphone, logo: Hexagon, food: UtensilsCrossed, interior: Sofa, character: Swords }

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(\{[^{}\s]{1,16}\})/g)
  return <>{parts.map((p, i) => (/^\{.*\}$/.test(p) ? <mark key={i} className="var-mark">{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>))}</>
}

function MineTab() {
  const { setComposer, toast, closeMarket, go, composer } = useStore()
  const [list, setList] = useState<PromptItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('')
  const [edit, setEdit] = useState<Partial<PromptItem> | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const reload = () => api<PromptItem[]>('/api/prompts').then(l => { setList(l); setLoaded(true) })
  useEffect(() => { reload().catch(() => setLoaded(true)) }, [])
  const tags = useMemo(() => Array.from(new Set(list.flatMap(p => p.tags))), [list])
  const kw = q.trim()
  const shown = list.filter(p => (!tag || p.tags.includes(tag)) && (!kw || p.title.includes(kw) || p.content.includes(kw) || p.tags.some(t => t.includes(kw))))
  const tpls = builtinTemplates.filter(t => !kw || t.name.includes(kw) || t.content.includes(kw))

  const use = (content: string, id?: number) => {
    setComposer({ text: content, chips: [], vars: {} })
    if (id) api(`/api/prompts/${id}/use`, { method: 'POST' }).catch(() => {})
    closeMarket(); go('generate'); toast('已套用提示词')
  }
  const pin = async (p: PromptItem) => { await api(`/api/prompts/${p.id}`, { method: 'PUT', body: { ...p, pinned: !p.pinned } }); reload() }
  const del = async (p: PromptItem) => { if (!confirm(`删除「${p.title}」？`)) return; await api(`/api/prompts/${p.id}`, { method: 'DELETE' }); reload(); toast('已删除') }
  const save = async () => {
    if (!edit?.content?.trim()) { toast('内容不能为空', 'info'); return }
    try {
      await api(edit.id ? `/api/prompts/${edit.id}` : '/api/prompts', { method: edit.id ? 'PUT' : 'POST', body: { ...edit, tags: edit.tags || [], is_template: /\{[^{}\s]{1,16}\}/.test(edit.content || '') } })
      setEdit(null); reload(); toast('已保存')
    } catch (e: any) { toast(e.message, 'err') }
  }
  const saveTpl = async (t: typeof builtinTemplates[number]) => {
    await api('/api/prompts', { body: { title: t.name, content: t.content, tags: t.tags, is_template: true } })
    reload(); toast('已存入我的提示词')
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
  const current = buildPrompt({ ...composer, vars: {} })

  return (
    <>
      <div className="mk-filters mk-filters-mine">
        <div className="search mk-search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索标题、内容或标签" /></div>
        <button className="btn btn-secondary" onClick={() => file.current?.click()}><Upload size={16} /><span className="hide-xs">导入</span></button>
        <a className="btn btn-secondary" href="/api/prompts/export"><Download size={16} /><span className="hide-xs">导出</span></a>
        {current.trim() && <button className="btn btn-secondary" onClick={() => setEdit({ title: '', content: current, tags: [] })}><BookmarkPlus size={16} /><span className="hide-xs">存当前</span></button>}
        <button className="btn btn-primary" onClick={() => setEdit({ title: '', content: '', tags: [] })}><Plus size={16} />新建</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
      </div>
      {tags.length > 0 && (
        <div className="mk-tags">
          <button className={`chip ${!tag ? 'is-on' : ''}`} onClick={() => setTag('')}>全部</button>
          {tags.map(t => <button key={t} className={`chip ${tag === t ? 'is-on' : ''}`} onClick={() => setTag(tag === t ? '' : t)}>{t}</button>)}
        </div>
      )}
      <div className="mk-scroll">
        {loaded && shown.length === 0 && !kw && <Empty art="book" title="还没有保存的提示词" />}
        {shown.length > 0 && (
          <div className="mk-grid">
            {shown.map(p => (
              <article key={p.id} className={`pcard ${p.pinned ? 'is-pinned' : ''}`}>
                <div className="pcard-head">
                  <h4 className="pcard-title" title={p.title}>{p.title}</h4>
                  {p.is_template && <span className="badge">模板</span>}
                  <button className={`icon-btn sm ${p.pinned ? 'is-star' : ''}`} onClick={() => pin(p)} title={p.pinned ? '取消置顶' : '置顶'} aria-label="置顶"><Pin size={16} /></button>
                </div>
                <p className="pcard-text" data-clamp><Highlight text={p.content} /></p>
                <div className="pcard-tags">{p.tags.map(t => <span key={t} className="tag-mini">{t}</span>)}<span className="pcard-uses">用过 {p.use_count} 次</span></div>
                <div className="mcard-foot">
                  <button className="icon-btn sm" onClick={() => setEdit(p)} aria-label="编辑" title="编辑"><Pencil size={16} /></button>
                  <button className="icon-btn sm is-danger" onClick={() => del(p)} aria-label="删除" title="删除"><Trash2 size={16} /></button>
                  <span className="grow" />
                  <button className="btn btn-primary btn-sm" onClick={() => use(p.content, p.id)}>套用</button>
                </div>
              </article>
            ))}
          </div>
        )}
        {tpls.length > 0 && <h3 className="mk-sec">精选模板</h3>}
        <div className="mk-grid">
          {tpls.map(t => {
            const Icon = coverIcon[t.cover] || Brush
            return (
              <article key={t.key} className="pcard">
                <div className="pcard-head">
                  <span className="pcard-icon"><Icon size={16} /></span>
                  <h4 className="pcard-title" title={t.name}>{t.name}</h4>
                  <span className="badge">模板</span>
                </div>
                <p className="pcard-text" data-clamp><Highlight text={t.content} /></p>
                <div className="pcard-tags">{t.tags.map(x => <span key={x} className="tag-mini">{x}</span>)}</div>
                <div className="mcard-foot">
                  <button className="icon-btn sm" title="存入我的提示词" aria-label="存入我的提示词" onClick={() => saveTpl(t)}><BookmarkPlus size={16} /></button>
                  <span className="grow" />
                  <button className="btn btn-primary btn-sm" onClick={() => use(t.content)}>套用</button>
                </div>
              </article>
            )
          })}
        </div>
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? '编辑提示词' : '新建提示词'}
        footer={<><button className="btn btn-secondary" onClick={() => setEdit(null)}>取消</button><button className="btn btn-primary" onClick={save}>保存</button></>}>
        {edit && <>
          <label className="field"><span className="field-label">标题</span><input className="input" value={edit.title || ''} onChange={e => setEdit({ ...edit, title: e.target.value })} placeholder="留空则取内容开头" /></label>
          <label className="field"><span className="field-label">内容</span><textarea className="input" rows={6} value={edit.content || ''} onChange={e => setEdit({ ...edit, content: e.target.value })} placeholder="可用 {角色}、{场景} 这样的变量" /></label>
          <label className="field"><span className="field-label">标签</span><TagInput value={edit.tags || []} onChange={tags => setEdit({ ...edit, tags })} /></label>
        </>}
      </Modal>
    </>
  )
}

// ---------------- 片段 ----------------
function SnipTab() {
  const { addChip, composer, setComposer, closeMarket } = useStore()
  const [g, setG] = useState(snippetGroups[0].key)
  const [q, setQ] = useState('')
  const groups = q ? snippetGroups.map(x => ({ ...x, items: x.items.filter(it => it.zh.includes(q) || it.en.toLowerCase().includes(q.toLowerCase())) })).filter(x => x.items.length) : snippetGroups.filter(x => x.key === g)
  return (
    <>
      <div className="mk-filters mk-filters-snip">
        <div className="search mk-search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索片段" /></div>
        <div className="snip-tabs">
          {snippetGroups.map(x => <button key={x.key} className={`chip ${!q && x.key === g ? 'is-on' : ''}`} onClick={() => { setQ(''); setG(x.key) }}>{x.name}</button>)}
        </div>
      </div>
      <div className="mk-scroll">
        {groups.length === 0 && <Empty art="book" title="没有匹配的片段" />}
        {groups.map(gr => (
          <section key={gr.key}>
            {q && <h3 className="mk-sec">{gr.name}</h3>}
            <div className="snip-grid">
              {gr.items.map(it => {
                const picked = composer.chips.includes(it.zh)
                return (
                  <button key={it.zh} className={`snip ${picked ? 'is-on' : ''}`} onClick={() => (picked ? setComposer(s => ({ chips: s.chips.filter(x => x !== it.zh) })) : addChip(it.zh))}>
                    <span className="snip-zh">{it.zh}</span>
                    <span className="snip-en" title={it.en}>{it.en}</span>
                  </button>
                )
              })}
            </div>
          </section>
        ))}
      </div>
      {composer.chips.length > 0 && <div className="mk-picked"><span>已选 {composer.chips.length} 个片段</span><button className="btn btn-primary btn-sm" onClick={closeMarket}>完成</button></div>}
    </>
  )
}
