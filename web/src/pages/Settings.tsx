import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Plug, RefreshCw, Check, Search, Route as RouteIcon, KeyRound, Lock, ArrowUp, ArrowDown, X } from 'lucide-react'
import { api, type Cap, type Caps, type Channel, type Preset } from '../api'
import { useStore } from '../store'
import { Empty, Modal, Segmented, Select, Spinner, TagInput } from '../components/ui'
import { PageHead } from './Compare'
import { Invites, Personal, System, Users } from './Admin'
import { apiTypeLabels, capLabels, modeLabels, valueLabel } from '../labels'

type Tab = 'channels' | 'users' | 'invites' | 'system' | 'me'
const tabs: { value: Tab; label: string }[] = [{ value: 'channels', label: '渠道' }, { value: 'users', label: '用户' }, { value: 'invites', label: '邀请码' }, { value: 'system', label: '系统' }, { value: 'me', label: '个人' }]

export default function Settings() {
  const { isAdmin } = useStore()
  const [tab, setTab] = useState<Tab>(() => (isAdmin ? ((sessionStorage.getItem('studio.settab') as Tab) || 'channels') : 'me'))
  const pick = (t: Tab) => { sessionStorage.setItem('studio.settab', t); setTab(t) }
  if (!isAdmin) return <div className="page page-settings"><PageHead title="设置" /><Personal /></div>
  return (
    <div className="page page-settings">
      <PageHead title="设置">
        <Segmented block={false} value={tab} onChange={v => pick(v as Tab)} options={tabs} />
      </PageHead>
      {tab === 'channels' ? <Channels /> : tab === 'users' ? <Users /> : tab === 'invites' ? <Invites /> : tab === 'system' ? <System /> : <Personal />}
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
        <span className="toolbar-title">{channels.length} 个渠道</span><span className="grow" />
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />新建渠道</button>
      </div>
      {channels.length === 0 && <div className="card card-empty"><Empty art="plug" title="还没有渠道" action={<button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />新建渠道</button>} /></div>}
      <div className="ch-list">
        {channels.map((c, i) => (
          <article key={c.id} className="card ch">
            <div className="ch-main">
              <div className="ch-title">
                <span className="ch-mark">{c.name.slice(0, 1)}</span>
                <div className="ch-name">
                  <h3>{c.name}</h3>
                  <span className="ch-url">{c.base_url}</span>
                </div>
              </div>
              <div className="ch-tags">
                <span className="mini-tag">{apiTypeLabels[c.api_type]}</span>
                <span className="mini-tag">{c.models.length} 个模型</span>
                {c.key_tail && <span className="mini-tag"><KeyRound size={12} />{c.key_tail}</span>}
                {c.hidden && <span className="mini-tag"><Lock size={12} />仅管理员</span>}
                {c.tool_path_at > 0 && <span className="mini-tag is-warn"><RouteIcon size={12} />对话工具链路</span>}
              </div>
              <CapSummary caps={c.caps} />
            </div>
            <div className="ch-actions">
              <button className="icon-btn sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label="上移"><ArrowUp size={14} /></button>
              <button className="icon-btn sm" onClick={() => move(i, 1)} disabled={i === channels.length - 1} aria-label="下移"><ArrowDown size={14} /></button>
              <button className="icon-btn sm" onClick={() => setEdit(c)} aria-label="编辑"><Pencil size={14} /></button>
              <button className="icon-btn sm is-danger" onClick={() => del(c)} aria-label="删除"><Trash2 size={14} /></button>
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
    if (!ch.name?.trim() || !ch.base_url?.trim()) { toast('名称和接口地址不能为空', 'info'); return }
    setSaving(true)
    try {
      await api(isNew ? '/api/channels' : `/api/channels/${initial.id}`, { method: isNew ? 'POST' : 'PUT', body: ch })
      onSaved()
    } catch (e: any) { toast(e.message, 'err') }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} wide title={isNew ? '新建渠道' : '编辑渠道'} className="ch-editor"
      footer={<><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving && <Spinner />}保存</button></>}>
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
        <label className="field span-2"><span className="field-label">接口地址</span><input className="input" value={ch.base_url || ''} onChange={e => setCh({ ...ch, base_url: e.target.value })} placeholder="https://example.com/v1" /></label>
        <div className="field span-2 field-inline"><span className="field-label">谁能用</span>
          <Segmented block={false} value={ch.hidden ? 'admin' : 'all'} onChange={v => setCh({ ...ch, hidden: v === 'admin' })} options={[{ value: 'all', label: '所有用户' }, { value: 'admin', label: '仅管理员' }]} />
        </div>
        <label className="field span-2"><span className="field-label">密钥</span>
          <input className="input" type="password" autoComplete="new-password" value={ch.api_key || ''} onChange={e => setCh({ ...ch, api_key: e.target.value })} placeholder={initial.key_tail ? `已保存 ${initial.key_tail}，留空不修改` : 'sk-…'} />
        </label>
      </div>

      <div className="field">
        <div className="field-row">
          <span className="field-label">模型</span>
          <span className="grow" />
          {probe.msg && <span className={`probe ${probe.ok ? 'ok' : 'err'}`}>{probe.ok ? <Check size={13} /> : <X size={13} />}{probe.msg}</span>}
          <button className="btn btn-secondary btn-sm" onClick={doProbe} disabled={probe.busy || !ch.base_url}>{probe.busy ? <Spinner size={13} /> : <RefreshCw size={13} />}测试连接并拉取</button>
        </div>
        <div className="models">
          {allModels.length > 8 && <div className="search sm"><Search size={14} /><input value={mq} onChange={e => setMq(e.target.value)} placeholder="筛选模型" /></div>}
          <div className="model-list">
            {shownModels.map(m => (
              <button key={m} className={`model ${ch.models?.includes(m) ? 'is-on' : ''}`} onClick={() => toggleModel(m)}>
                <span className="cbox">{ch.models?.includes(m) && <Check size={11} strokeWidth={3} />}</span><span >{m}</span>
              </button>
            ))}
            {allModels.length === 0 && <span className="muted sm-text">暂无模型</span>}
          </div>
          <div className="model-add">
            <input className="input" value={manual} onChange={e => setManual(e.target.value)} placeholder="手动添加模型名"
              onKeyDown={e => { if (e.key === 'Enter' && manual.trim()) { const m = manual.trim(); setCh(c => ({ ...c, models: Array.from(new Set([...(c.models || []), m])) })); setManual('') } }} />
            <button className="btn btn-secondary btn-sm" onClick={() => { const m = manual.trim(); if (m) { setCh(c => ({ ...c, models: Array.from(new Set([...(c.models || []), m])) })); setManual('') } }}><Plus size={13} />添加</button>
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
                        <Select size="sm" className="cap-default" value={cap.default || cap.values![0]} onChange={v => setCap(k, { default: v })}
                          options={(cap.values || []).map(v => ({ value: v, label: '默认 ' + valueLabel(k, v) }))} />
                      )}
                    </div>
                  )}
                  {!off && (k === 'n' || k === 'refs') && (
                    <label className="cap-max"><span>上限</span><input className="input" type="number" min={k === 'n' ? 1 : 0} max={k === 'n' ? 16 : 32} value={cap.max ?? 0} onChange={e => setCap(k, { max: Number(e.target.value) })} /></label>
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
