import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Plug, RefreshCw, Check, Search, Route as RouteIcon, LogOut, Sun, Moon, Monitor, KeyRound, ArrowUp, ArrowDown, X } from 'lucide-react'
import { api, type Cap, type Caps, type Channel, type Preset } from '../api'
import { useStore, type ThemePref } from '../store'
import { Empty, Modal, Segmented, Select, Spinner, TagInput } from '../components/ui'
import { PageHead } from './Generate'
import { apiTypeLabels, capLabels, fmtBytes, modeLabels, valueLabel } from '../labels'

export default function Settings() {
  const [tab, setTab] = useState<'channels' | 'general'>('channels')
  return (
    <div className="page page-settings">
      <PageHead title="设置">
        <Segmented value={tab} onChange={v => setTab(v as any)} options={[{ value: 'channels', label: '渠道' }, { value: 'general', label: '通用' }]} />
      </PageHead>
      {tab === 'channels' ? <Channels /> : <General />}
    </div>
  )
}

function Channels() {
  const { channels, reloadChannels, toast } = useStore()
  const [edit, setEdit] = useState<Partial<Channel> | null>(null)
  const del = async (c: Channel) => {
    if (!confirm(`删除渠道「${c.name}」？已生成的图片不受影响。`)) return
    await api(`/api/channels/${c.id}`, { method: 'DELETE' })
    await reloadChannels()
    toast('已删除')
  }
  const move = async (i: number, d: number) => {
    const ids = channels.map(c => c.id)
    const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    await api('/api/channels/order', { body: ids })
    reloadChannels()
  }
  return (
    <div className="channels">
      <div className="toolbar">
        <span className="grow toolbar-title">{channels.length} 个渠道</span>
        <button className="btn btn-accent" onClick={() => setEdit({})}><Plus size={15} />新建渠道</button>
      </div>
      {channels.length === 0 && <div className="card onboarding"><Empty art="plug" title="还没有渠道" action={<button className="btn btn-accent" onClick={() => setEdit({})}><Plus size={15} />新建渠道</button>} /></div>}
      <div className="ch-list">
        {channels.map((c, i) => (
          <article key={c.id} className="card ch">
            <div className="ch-main">
              <div className="ch-title">
                <span className="ch-mark">{c.name.slice(0, 1)}</span>
                <div className="ch-name">
                  <h3>{c.name}</h3>
                  <span className="ch-url mono">{c.base_url}</span>
                </div>
              </div>
              <div className="ch-tags">
                <span className="mini-tag">{apiTypeLabels[c.api_type]}</span>
                <span className="mini-tag">{c.models.length} 个模型</span>
                {c.key_tail && <span className="mini-tag mono"><KeyRound size={11} />{c.key_tail}</span>}
                {c.tool_path_at > 0 && <span className="mini-tag is-warn"><RouteIcon size={11} />对话工具链路</span>}
              </div>
              <CapSummary caps={c.caps} />
            </div>
            <div className="ch-actions">
              <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移"><ArrowUp size={14} /></button>
              <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === channels.length - 1} aria-label="下移"><ArrowDown size={14} /></button>
              <button className="icon-btn sm" onClick={() => setEdit(c)} aria-label="编辑"><Pencil size={14} /></button>
              <button className="icon-btn sm danger" onClick={() => del(c)} aria-label="删除"><Trash2 size={14} /></button>
            </div>
          </article>
        ))}
      </div>
      {edit && <ChannelEditor initial={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await reloadChannels(); toast('渠道已保存') }} />}
    </div>
  )
}

function CapSummary({ caps }: { caps: Caps }) {
  const keys: (keyof Caps)[] = ['aspect', 'size', 'resolution', 'quality', 'n', 'format', 'background', 'refs']
  return (
    <div className="cap-sum">
      {keys.filter(k => caps[k] && caps[k].mode !== 'off').map(k => (
        <span key={k} className={`cap-pill mode-${caps[k].mode}`}>
          {capLabels[k]}<i>{k === 'refs' ? `≤${caps[k].max || 0}` : k === 'n' ? `≤${caps[k].max || 1}` : modeLabels[caps[k].mode]}</i>
        </span>
      ))}
    </div>
  )
}

const emptyCaps = (): Caps => ({
  size: { mode: 'off' }, aspect: { mode: 'off' }, resolution: { mode: 'off' }, quality: { mode: 'off' }, n: { mode: 'native', max: 1 },
  format: { mode: 'off' }, compression: { mode: 'off' }, background: { mode: 'off' }, moderation: { mode: 'off' }, response: { mode: 'off' }, refs: { mode: 'off', max: 0 },
})

const capModes: Record<keyof Caps, string[]> = {
  size: ['native', 'prompt', 'off'], aspect: ['native', 'prompt', 'off'], resolution: ['native', 'prompt', 'off'], quality: ['native', 'prompt', 'off'],
  n: ['native', 'loop', 'off'], format: ['native', 'off'], compression: ['native', 'off'], background: ['native', 'prompt', 'off'], moderation: ['native', 'off'],
  response: ['native', 'off'], refs: ['multipart', 'json', 'off'],
}
const capHasValues: (keyof Caps)[] = ['size', 'aspect', 'resolution', 'quality', 'format', 'background', 'moderation']
const capOrder: (keyof Caps)[] = ['aspect', 'size', 'resolution', 'quality', 'n', 'format', 'compression', 'background', 'moderation', 'response', 'refs']

function ChannelEditor({ initial, onClose, onSaved }: { initial: Partial<Channel>; onClose: () => void; onSaved: () => void }) {
  const { toast } = useStore()
  const isNew = !initial.id
  const [presets, setPresets] = useState<Preset[]>([])
  const [ch, setCh] = useState<Partial<Channel>>(() => ({ name: '', base_url: '', api_key: '', api_type: 'images', models: [], caps: emptyCaps(), ...initial, ...(initial.id ? { api_key: '' } : {}) }))
  const [remote, setRemote] = useState<string[] | null>(null)
  const [probe, setProbe] = useState<{ busy: boolean; ok?: boolean; msg?: string }>({ busy: false })
  const [mq, setMq] = useState('')
  const [manual, setManual] = useState('')
  const [saving, setSaving] = useState(false)
  const [preset, setPreset] = useState('')

  useEffect(() => { api<Preset[]>('/api/presets').then(setPresets).catch(() => {}) }, [])
  const caps = (ch.caps || emptyCaps()) as Caps
  const setCap = (k: keyof Caps, patch: Partial<Cap>) => setCh(c => ({ ...c, caps: { ...(c.caps as Caps), [k]: { ...(c.caps as Caps)[k], ...patch } } }))

  const applyPreset = (p: Preset) => {
    setPreset(p.key)
    setCh(c => ({
      ...c,
      name: c.name || p.name,
      base_url: p.base_url || c.base_url,
      api_type: p.api_type,
      models: p.models && p.models.length ? (c.models?.length ? c.models : p.models.slice(0, 1)) : c.models,
      caps: JSON.parse(JSON.stringify(p.caps)),
    }))
    if (p.models?.length) setRemote(r => Array.from(new Set([...(r || []), ...p.models!])))
  }

  const doProbe = async () => {
    setProbe({ busy: true })
    try {
      const res = await api<{ ok: boolean; models?: string[]; error?: string; latency_ms?: number }>('/api/channels/probe', { body: { id: initial.id || 0, base_url: ch.base_url, api_key: ch.api_key } })
      if (res.ok) {
        setRemote(Array.from(new Set([...(res.models || []), ...(ch.models || [])])))
        setProbe({ busy: false, ok: true, msg: `连接正常 · ${res.latency_ms} 毫秒 · ${res.models?.length || 0} 个模型` })
      } else setProbe({ busy: false, ok: false, msg: res.error })
    } catch (e: any) { setProbe({ busy: false, ok: false, msg: e.message }) }
  }

  const toggleModel = (m: string) => setCh(c => ({ ...c, models: c.models?.includes(m) ? c.models.filter(x => x !== m) : [...(c.models || []), m] }))
  const allModels = useMemo(() => Array.from(new Set([...(remote || []), ...(ch.models || [])])), [remote, ch.models])
  const shownModels = allModels.filter(m => !mq || m.toLowerCase().includes(mq.toLowerCase()))

  const save = async () => {
    if (!ch.name?.trim() || !ch.base_url?.trim()) { toast('名称和 Base URL 不能为空', 'info'); return }
    setSaving(true)
    try {
      await api(isNew ? '/api/channels' : `/api/channels/${initial.id}`, { method: isNew ? 'POST' : 'PUT', body: ch })
      onSaved()
    } catch (e: any) { toast(e.message, 'err') }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} wide title={isNew ? '新建渠道' : '编辑渠道'} className="ch-editor"
      footer={<><button className="btn btn-ghost" onClick={onClose}>取消</button><button className="btn btn-accent" onClick={save} disabled={saving}>{saving && <Spinner />}保存</button></>}>
      {isNew && presets.length > 0 && (
        <div className="field">
          <span className="field-label">快速填充</span>
          <div className="presets">
            {presets.map(p => <button key={p.key} className={`preset ${preset === p.key ? 'is-on' : ''}`} onClick={() => applyPreset(p)}>{p.name}</button>)}
          </div>
        </div>
      )}
      <div className="form-grid">
        <label className="field"><span className="field-label">名称</span><input className="input" value={ch.name || ''} onChange={e => setCh({ ...ch, name: e.target.value })} /></label>
        <div className="field"><span className="field-label">接口类型</span>
          <Segmented value={ch.api_type || 'images'} onChange={v => setCh({ ...ch, api_type: v as any })} options={[{ value: 'images', label: apiTypeLabels.images }, { value: 'chat', label: apiTypeLabels.chat }]} />
        </div>
        <label className="field span-2"><span className="field-label">Base URL</span><input className="input mono" value={ch.base_url || ''} onChange={e => setCh({ ...ch, base_url: e.target.value })} placeholder="https://example.com/v1" /></label>
        <label className="field span-2"><span className="field-label">API Key</span>
          <input className="input mono" type="password" autoComplete="new-password" value={ch.api_key || ''} onChange={e => setCh({ ...ch, api_key: e.target.value })} placeholder={initial.key_tail ? `已保存 ${initial.key_tail}，留空不修改` : 'sk-…'} />
        </label>
      </div>

      <div className="field">
        <div className="field-row">
          <span className="field-label">模型</span>
          <span className="grow" />
          {probe.msg && <span className={`probe ${probe.ok ? 'ok' : 'err'}`}>{probe.ok ? <Check size={13} /> : <X size={13} />}{probe.msg}</span>}
          <button className="btn btn-ghost sm" onClick={doProbe} disabled={probe.busy || !ch.base_url}>{probe.busy ? <Spinner size={13} /> : <RefreshCw size={13} />}测试连接并拉取</button>
        </div>
        <div className="models">
          {allModels.length > 8 && <div className="search sm"><Search size={14} /><input value={mq} onChange={e => setMq(e.target.value)} placeholder="筛选模型" /></div>}
          <div className="model-list">
            {shownModels.map(m => (
              <button key={m} className={`model ${ch.models?.includes(m) ? 'is-on' : ''}`} onClick={() => toggleModel(m)}>
                <span className="cbox">{ch.models?.includes(m) && <Check size={11} strokeWidth={3} />}</span><span className="mono">{m}</span>
              </button>
            ))}
            {allModels.length === 0 && <span className="muted sm-text">暂无模型</span>}
          </div>
          <div className="model-add">
            <input className="input mono" value={manual} onChange={e => setManual(e.target.value)} placeholder="手动添加模型名"
              onKeyDown={e => { if (e.key === 'Enter' && manual.trim()) { const m = manual.trim(); setCh(c => ({ ...c, models: Array.from(new Set([...(c.models || []), m])) })); setManual('') } }} />
            <button className="btn btn-ghost sm" onClick={() => { const m = manual.trim(); if (m) { setCh(c => ({ ...c, models: Array.from(new Set([...(c.models || []), m])) })); setManual('') } }}><Plus size={13} />添加</button>
          </div>
        </div>
      </div>

      <div className="field">
        <span className="field-label">能力档案</span>
        <div className="caps">
          {capOrder.map(k => {
            const cap = caps[k] || { mode: 'off' }
            const off = cap.mode === 'off'
            return (
              <div key={k} className={`cap ${off ? 'is-off' : ''}`}>
                <div className="cap-name">{capLabels[k]}</div>
                <div className="cap-mode">
                  <Segmented size="sm" value={cap.mode} onChange={v => setCap(k, { mode: v as any })} options={capModes[k].map(m => ({ value: m, label: modeLabels[m] }))} />
                </div>
                <div className="cap-detail">
                  {!off && capHasValues.includes(k) && (
                    <div className="cap-values">
                      <TagInput value={cap.values || []} onChange={values => setCap(k, { values, default: values.includes(cap.default || '') ? cap.default : values[0] })} placeholder="可选值" />
                      {(cap.values || []).length > 1 && (
                        <Select className="cap-default" value={cap.default || cap.values![0]} onChange={v => setCap(k, { default: v })}
                          options={(cap.values || []).map(v => ({ value: v, label: '默认 ' + valueLabel(k, v) }))} />
                      )}
                    </div>
                  )}
                  {!off && (k === 'n' || k === 'refs') && (
                    <label className="cap-max"><span>上限</span><input className="input mono" type="number" min={k === 'n' ? 1 : 0} max={16} value={cap.max ?? 0} onChange={e => setCap(k, { max: Number(e.target.value) })} /></label>
                  )}
                  {!off && k === 'response' && (
                    <Segmented size="sm" value={cap.values?.[0] || 'url'} onChange={v => setCap(k, { values: [v] })} options={[{ value: 'url', label: '链接' }, { value: 'b64_json', label: '内嵌数据' }]} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}

function General() {
  const { theme, setTheme, toast } = useStore()
  const [s, setS] = useState<{ retention_days: number; images: number; favorites: number; bytes: number; version: string } | null>(null)
  const [days, setDays] = useState('0')
  const load = () => api('/api/settings').then(x => { setS(x); setDays(String(x.retention_days)) })
  useEffect(() => { load().catch(() => {}) }, [])
  const save = async (clean = false) => {
    const res = await api<{ removed: number }>('/api/settings', { method: 'PUT', body: { retention_days: Math.max(0, Number(days) || 0), clean_now: clean } })
    toast(clean ? `已清理 ${res.removed} 张` : '已保存')
    load()
  }
  const logout = async () => { await api('/api/logout', { method: 'POST' }); location.reload() }
  const themes: { v: ThemePref; label: string; icon: any }[] = [{ v: 'system', label: '跟随系统', icon: Monitor }, { v: 'light', label: '浅色', icon: Sun }, { v: 'dark', label: '深色', icon: Moon }]
  return (
    <div className="general">
      <section className="card gcard">
        <h3>外观</h3>
        <div className="theme-pick">
          {themes.map(t => (
            <button key={t.v} className={`theme-opt t-${t.v} ${theme === t.v ? 'is-on' : ''}`} onClick={() => setTheme(t.v)}>
              <span className="theme-swatch"><i /><i /><i /></span>
              <span className="theme-label"><t.icon size={14} />{t.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="card gcard">
        <h3>历史清理</h3>
        <div className="g-row">
          <span>未收藏的历史图片保留</span>
          <div className="num-input"><input className="input mono" type="number" min={0} value={days} onChange={e => setDays(e.target.value)} /><span>天</span></div>
          {Number(days) <= 0 && <span className="muted">当前不清理</span>}
          <span className="grow" />
          <button className="btn btn-ghost" onClick={() => save(false)}>保存</button>
          {Number(days) > 0 && <button className="btn btn-ghost" onClick={() => save(true)}>立即清理</button>}
        </div>
        {s && (
          <div className="stats">
            <div><b>{s.images}</b><span>全部图片</span></div>
            <div><b>{s.favorites}</b><span>资产</span></div>
            <div><b>{fmtBytes(s.bytes)}</b><span>原图占用</span></div>
          </div>
        )}
      </section>
      <section className="card gcard">
        <h3>账户</h3>
        <div className="g-row">
          <span className="muted">版本 {s?.version || ''}</span>
          <span className="grow" />
          <button className="btn btn-ghost" onClick={logout}><LogOut size={15} />退出登录</button>
        </div>
      </section>
    </div>
  )
}
