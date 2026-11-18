import { useEffect, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Copy, Check, LogOut, Sun, Moon, Monitor, Ban, Gift, RotateCcw, Search } from 'lucide-react'
import { api, type Invite, type UserRow } from '../api'
import { useStore, type ThemePref } from '../store'
import { Empty, Modal, Segmented, Spinner, copyText } from '../components/ui'
import { fmtBytes, fmtTime } from '../labels'

const quotaText = (q: number) => (q === 0 ? '不限' : String(q))

// ---------- 用户 ----------
export function Users() {
  const { toast, me } = useStore()
  const [list, setList] = useState<UserRow[] | null>(null)
  const [edit, setEdit] = useState<Partial<UserRow> | null>(null)
  const [grant, setGrant] = useState<UserRow | null>(null)
  const [q, setQ] = useState('')
  const load = () => api<UserRow[]>('/api/users').then(setList).catch(e => toast(e.message, 'err'))
  useEffect(() => { load() }, [])
  const shown = (list || []).filter(u => !q || (u.username + u.nickname).toLowerCase().includes(q.toLowerCase()))

  const toggle = async (u: UserRow) => {
    await api(`/api/users/${u.id}`, { method: 'PUT', body: { disabled: !u.disabled } }).catch(e => toast(e.message, 'err'))
    toast(u.disabled ? '已启用' : '已停用'); load()
  }
  const del = async (u: UserRow) => {
    if (!confirm(`删除用户「${u.display}」？`)) return
    const purge = u.images > 0 && confirm(`同时删除 ${u.display} 的 ${u.images} 张图片？\n选择「取消」则图片转到你的名下。`)
    try { await api(`/api/users/${u.id}${purge ? '?purge=1' : ''}`, { method: 'DELETE' }); toast('已删除'); load() } catch (e: any) { toast(e.message, 'err') }
  }

  if (!list) return <div className="center-pad"><Spinner /></div>
  return (
    <div className="channels">
      <div className="toolbar">
        {list.length > 6 ? <div className="search"><Search size={16} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索用户" /></div> : <span className="toolbar-title">{list.length} 个用户</span>}
        <span className="grow" />
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />新建用户</button>
      </div>
      <div className="ch-list">
        {shown.map(u => {
          const admin = u.role === 'admin'
          return (
            <article key={u.id} className={`card ch user-card ${u.disabled ? 'is-off' : ''}`}>
              <div className="ch-main">
                <div className="ch-title">
                  <span className="ch-mark">{(u.display || u.username).slice(0, 1).toUpperCase()}</span>
                  <div className="ch-name">
                    <h3>{u.display}{u.id === me.id && <span className="you">（我）</span>}</h3>
                    <span className="ch-url">{u.nickname ? u.username + ' · ' : ''}{u.last_login_at ? '最近登录 ' + fmtTime(u.last_login_at) : '从未登录'}</span>
                  </div>
                </div>
                <div className="ch-tags">
                  {admin && <span className="mini-tag is-accent">管理员</span>}
                  {u.disabled && <span className="mini-tag is-danger">已停用</span>}
                  {!admin && <span className="mini-tag">今日 {u.used_today}/{quotaText(u.quota)}</span>}
                  {!admin && u.bonus > 0 && <span className="mini-tag">额外 {u.bonus}</span>}
                  {!admin && u.allowed_models.length > 0 && <span className="mini-tag">{u.allowed_models.length} 个模型</span>}
                  <span className="mini-tag">{u.images} 张 · {fmtBytes(u.bytes)}</span>
                  {u.active_jobs > 0 && <span className="mini-tag is-warn">生成中 {u.active_jobs}</span>}
                </div>
              </div>
              <div className="ch-actions">
                {!admin && <button className="icon-btn sm" onClick={() => setGrant(u)} aria-label="发放额度" title="发放额度"><Gift size={14} /></button>}
                <button className="icon-btn sm" onClick={() => setEdit(u)} aria-label="编辑" title="编辑"><Pencil size={14} /></button>
                {u.id !== me.id && <button className="icon-btn sm" onClick={() => toggle(u)} aria-label={u.disabled ? '启用' : '停用'} title={u.disabled ? '启用' : '停用'}><Ban size={14} /></button>}
                {u.id !== me.id && <button className="icon-btn sm is-danger" onClick={() => del(u)} aria-label="删除" title="删除"><Trash2 size={14} /></button>}
              </div>
            </article>
          )
        })}
      </div>
      {edit && <UserEditor initial={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); toast('已保存') }} />}
      {grant && <GrantModal user={grant} onClose={() => setGrant(null)} onDone={() => { setGrant(null); load() }} />}
    </div>
  )
}

type QuotaMode = 'default' | 'custom' | 'unlimited'

function UserEditor({ initial, onClose, onSaved }: { initial: Partial<UserRow>; onClose: () => void; onSaved: () => void }) {
  const { toast, channels, me } = useStore()
  const isNew = !initial.id
  const [u, setU] = useState({ username: '', nickname: '', role: 'user', allowed_models: [] as string[], daily_quota: -1, max_concurrent: 0, ...initial })
  const [pw, setPw] = useState('')
  const [qm, setQm] = useState<QuotaMode>(() => (u.daily_quota! < 0 ? 'default' : u.daily_quota === 0 ? 'unlimited' : 'custom'))
  const [quota, setQuota] = useState(String(u.daily_quota! > 0 ? u.daily_quota : 20))
  const [limitModels, setLimitModels] = useState((u.allowed_models || []).length > 0)
  const [saving, setSaving] = useState(false)
  const models = useMemo(() => Array.from(new Set(channels.flatMap(c => c.models))), [channels])
  const isUser = u.role !== 'admin'

  const save = async () => {
    if (isNew && (!u.username!.trim() || pw.length < 6)) { toast('用户名必填，密码至少 6 位', 'info'); return }
    setSaving(true)
    const body: any = {
      nickname: u.nickname, role: u.role,
      daily_quota: qm === 'default' ? -1 : qm === 'unlimited' ? 0 : Math.max(1, Number(quota) || 1),
      max_concurrent: Math.max(0, Number(u.max_concurrent) || 0),
      allowed_models: limitModels ? u.allowed_models : [],
    }
    if (isNew) body.username = u.username!.trim()
    if (pw) body.password = pw
    try {
      await api(isNew ? '/api/users' : `/api/users/${initial.id}`, { method: isNew ? 'POST' : 'PUT', body })
      onSaved()
    } catch (e: any) { toast(e.message, 'err') } finally { setSaving(false) }
  }
  const toggleModel = (m: string) => setU(x => ({ ...x, allowed_models: x.allowed_models!.includes(m) ? x.allowed_models!.filter(y => y !== m) : [...x.allowed_models!, m] }))

  return (
    <Modal open onClose={onClose} title={isNew ? '新建用户' : '编辑用户'}
      footer={<><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving && <Spinner />}保存</button></>}>
      <div className="form-grid">
        <label className="field"><span className="field-label">用户名</span>
          <input className="input" value={u.username} disabled={!isNew} autoComplete="off" onChange={e => setU({ ...u, username: e.target.value })} /></label>
        <label className="field"><span className="field-label">昵称</span>
          <input className="input" value={u.nickname} onChange={e => setU({ ...u, nickname: e.target.value })} /></label>
        <label className="field span-2"><span className="field-label">{isNew ? '密码' : '重置密码'}</span>
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} placeholder={isNew ? '至少 6 位' : '留空不修改'} /></label>
        {initial.id !== me.id && (
          <div className="field span-2"><span className="field-label">角色</span>
            <Segmented value={u.role!} onChange={v => setU({ ...u, role: v as any })} options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]} /></div>
        )}
      </div>
      {isUser && <>
        <div className="field">
          <span className="field-label">每日额度</span>
          <div className="g-row">
            <Segmented block={false} value={qm} onChange={v => setQm(v as QuotaMode)} options={[{ value: 'default', label: '跟随默认' }, { value: 'custom', label: '自定义' }, { value: 'unlimited', label: '不限' }]} />
            {qm === 'custom' && <div className="num-input"><input className="input" type="number" min={1} value={quota} onChange={e => setQuota(e.target.value)} /><span>张</span></div>}
          </div>
        </div>
        <div className="field">
          <span className="field-label">同时进行的任务</span>
          <div className="g-row">
            <div className="num-input"><input className="input" type="number" min={0} value={u.max_concurrent} onChange={e => setU({ ...u, max_concurrent: Number(e.target.value) })} /><span>个</span></div>
            {Number(u.max_concurrent) <= 0 && <span className="muted">跟随默认</span>}
          </div>
        </div>
        <div className="field">
          <div className="field-row"><span className="field-label">可用模型</span><span className="grow" />
            <Segmented size="sm" block={false} value={limitModels ? 'some' : 'all'} onChange={v => setLimitModels(v === 'some')} options={[{ value: 'all', label: '全部' }, { value: 'some', label: '指定' }]} /></div>
          {limitModels && (
            <div className="model-list">
              {models.map(m => (
                <button key={m} className={`model ${u.allowed_models!.includes(m) ? 'is-on' : ''}`} onClick={() => toggleModel(m)}>
                  <span className="cbox">{u.allowed_models!.includes(m) && <Check size={11} strokeWidth={3} />}</span><span>{m}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </>}
    </Modal>
  )
}

function GrantModal({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const { toast } = useStore()
  const [n, setN] = useState('10')
  const [busy, setBusy] = useState(false)
  const run = async (body: any, msg: string) => {
    setBusy(true)
    try { await api(`/api/users/${user.id}`, { method: 'PUT', body }); toast(msg); onDone() } catch (e: any) { toast(e.message, 'err') } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={`额度 · ${user.display}`}
      footer={<><button className="btn btn-secondary" onClick={onClose}>取消</button><button className="btn btn-primary" disabled={busy || !(Number(n) > 0)} onClick={() => run({ add_bonus: Number(n) }, `已发放 ${n} 张`)}>{busy && <Spinner />}发放</button></>}>
      <div className="stats stats-tight">
        <div><b>{user.used_today}/{quotaText(user.quota)}</b><span>今日已用</span></div>
        <div><b>{user.bonus}</b><span>额外额度</span></div>
        <div><b>{user.total_gen}</b><span>累计生成</span></div>
      </div>
      <div className="g-row grant-row">
        <span>发放额外额度</span>
        <div className="num-input"><input className="input" type="number" min={1} value={n} onChange={e => setN(e.target.value)} /><span>张</span></div>
        <span className="grow" />
        {user.used_today > 0 && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run({ reset_today: true }, '今日用量已清零')}><RotateCcw size={14} />清零今日用量</button>}
        {user.bonus > 0 && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => run({ bonus: 0 }, '额外额度已收回')}>收回额外额度</button>}
      </div>
    </Modal>
  )
}

// ---------- 邀请码 ----------
export function Invites() {
  const { toast } = useStore()
  const [list, setList] = useState<Invite[] | null>(null)
  const [mode, setMode] = useState('')
  const [count, setCount] = useState('1')
  const [uses, setUses] = useState('1')
  const [days, setDays] = useState('7')
  const [copied, setCopied] = useState('')
  const load = () => api<Invite[]>('/api/invites').then(setList).catch(() => setList([]))
  useEffect(() => { load(); api('/api/settings').then(s => setMode(s.register_mode)).catch(() => {}) }, [])
  const create = async () => {
    const res = await api<{ codes: string[] }>('/api/invites', { body: { count: Number(count) || 1, max_uses: Math.max(0, Number(uses) || 0), days: Math.max(0, Number(days) || 0) } })
    if (res.codes.length === 1 && await copyText(res.codes[0])) toast('邀请码已复制')
    else toast(`已生成 ${res.codes.length} 个`)
    load()
  }
  const copy = async (c: string) => { if (await copyText(c)) { setCopied(c); setTimeout(() => setCopied(''), 1400) } }
  const del = async (c: string) => { await api(`/api/invites/${c}`, { method: 'DELETE' }); load() }
  const t = Date.now()
  return (
    <div className="general">
      <section className="card gcard">
        <h3>生成邀请码</h3>
        <div className="g-row">
          <div className="num-input"><span>数量</span><input className="input" type="number" min={1} max={50} value={count} onChange={e => setCount(e.target.value)} /></div>
          <div className="num-input"><span>每个可用</span><input className="input" type="number" min={0} value={uses} onChange={e => setUses(e.target.value)} /><span>次</span></div>
          <div className="num-input"><span>有效</span><input className="input" type="number" min={0} value={days} onChange={e => setDays(e.target.value)} /><span>天</span></div>
          <span className="grow" />
          <button className="btn btn-primary" onClick={create}><Plus size={16} />生成</button>
        </div>
        {mode && mode !== 'invite' && <p className="g-note">当前注册方式不是「邀请码」，邀请码暂不生效</p>}
      </section>
      <section className="card gcard">
        <h3>已有邀请码</h3>
        {!list ? <Spinner /> : list.length === 0 ? <Empty art="frame" title="还没有邀请码" /> : (
          <div className="inv-list">
            {list.map(i => {
              const dead = (i.max_uses > 0 && i.used >= i.max_uses) || (i.expires_at > 0 && i.expires_at < t)
              return (
                <div key={i.code} className={`inv ${dead ? 'is-dead' : ''}`}>
                  <code className="inv-code">{i.code}</code>
                  <span className="inv-meta">{i.max_uses > 0 ? `${i.used}/${i.max_uses}` : `${i.used}/不限`}</span>
                  <span className="inv-meta">{dead ? (i.expires_at > 0 && i.expires_at < t ? '已过期' : '已用完') : i.expires_at ? fmtTime(i.expires_at) + ' 到期' : '长期有效'}</span>
                  <span className="grow" />
                  {!dead && <button className="icon-btn sm" onClick={() => copy(i.code)} aria-label="复制">{copied === i.code ? <Check size={14} /> : <Copy size={14} />}</button>}
                  <button className="icon-btn sm is-danger" onClick={() => del(i.code)} aria-label="删除"><Trash2 size={14} /></button>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

// ---------- 系统 ----------
interface Sys { retention_hours: number; register_mode: string; default_quota: number; default_concurrent: number; images: number; favorites: number; bytes: number; fav_bytes: number; users: number; today_images: number; version: string }

export function System() {
  const { toast, reloadMe } = useStore()
  const [s, setS] = useState<Sys | null>(null)
  const [f, setF] = useState({ hours: '0', quota: '20', conc: '2', mode: 'closed' })
  const load = () => api<Sys>('/api/settings').then(x => { setS(x); setF({ hours: String(x.retention_hours), quota: String(x.default_quota), conc: String(x.default_concurrent), mode: x.register_mode }) })
  useEffect(() => { load().catch(() => {}) }, [])
  const save = async (clean = false) => {
    try {
      const res = await api<{ removed: number }>('/api/settings', { method: 'PUT', body: { retention_hours: Math.max(0, Number(f.hours) || 0), register_mode: f.mode, default_quota: Math.max(0, Number(f.quota) || 0), default_concurrent: Math.max(1, Number(f.conc) || 1), clean_now: clean } })
      toast(clean ? `已清理 ${res.removed} 张` : '已保存')
      load(); reloadMe()
    } catch (e: any) { toast(e.message, 'err') }
  }
  const hours = Number(f.hours) || 0
  return (
    <div className="general">
      <section className="card gcard">
        <h3>临时图片</h3>
        <div className="g-row">
          <span>未收藏的图片保留</span>
          <div className="num-input"><input className="input" type="number" min={0} value={f.hours} onChange={e => setF({ ...f, hours: e.target.value })} /><span>小时</span></div>
          <Segmented size="sm" block={false} value={['24', '72', '168', '720'].includes(f.hours) ? f.hours : ''} onChange={v => setF({ ...f, hours: v })}
            options={[{ value: '24', label: '1 天' }, { value: '72', label: '3 天' }, { value: '168', label: '7 天' }, { value: '720', label: '30 天' }]} />
          {hours <= 0 && <span className="muted">不清理</span>}
        </div>
        {s && (
          <div className="stats">
            <div><b>{s.images - s.favorites}</b><span>临时 · {fmtBytes(s.bytes - s.fav_bytes)}</span></div>
            <div><b>{s.favorites}</b><span>收藏 · {fmtBytes(s.fav_bytes)}</span></div>
            <div><b>{s.today_images}</b><span>今日生成</span></div>
          </div>
        )}
      </section>
      <section className="card gcard">
        <h3>注册与额度</h3>
        <div className="g-col">
          <div className="g-row"><span className="g-k">注册方式</span>
            <Segmented block={false} value={f.mode} onChange={v => setF({ ...f, mode: v })} options={[{ value: 'closed', label: '关闭' }, { value: 'invite', label: '邀请码' }, { value: 'open', label: '开放' }]} /></div>
          <div className="g-row"><span className="g-k">默认每日额度</span>
            <div className="num-input"><input className="input" type="number" min={0} value={f.quota} onChange={e => setF({ ...f, quota: e.target.value })} /><span>张</span></div>
            {Number(f.quota) <= 0 && <span className="muted">不限</span>}</div>
          <div className="g-row"><span className="g-k">默认同时任务</span>
            <div className="num-input"><input className="input" type="number" min={1} value={f.conc} onChange={e => setF({ ...f, conc: e.target.value })} /><span>个</span></div></div>
        </div>
      </section>
      <div className="g-row g-foot">
        <span className="muted">版本 {s?.version || ''}</span>
        <span className="grow" />
        {hours > 0 && <button className="btn btn-secondary" onClick={() => save(true)}>保存并立即清理</button>}
        <button className="btn btn-primary" onClick={() => save(false)}>保存</button>
      </div>
    </div>
  )
}

// ---------- 个人 ----------
export function Personal() {
  const { theme, setTheme, toast, me, quota, reloadMe, isAdmin, retentionHours } = useStore()
  const [nick, setNick] = useState(me.nickname)
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const themes: { v: ThemePref; label: string; icon: any }[] = [{ v: 'system', label: '跟随系统', icon: Monitor }, { v: 'light', label: '浅色', icon: Sun }, { v: 'dark', label: '深色', icon: Moon }]
  const logout = async () => { await api('/api/logout', { method: 'POST' }); location.reload() }
  const saveNick = async () => { try { await api('/api/account', { method: 'PUT', body: { nickname: nick.trim() } }); toast('已保存'); reloadMe() } catch (e: any) { toast(e.message, 'err') } }
  const savePw = async () => {
    try { await api('/api/account', { method: 'PUT', body: { old_password: oldPw, new_password: newPw } }); toast('密码已修改'); setOldPw(''); setNewPw('') } catch (e: any) { toast(e.message, 'err') }
  }
  return (
    <div className="general">
      {!isAdmin && quota && (
        <section className="card gcard">
          <h3>今日额度</h3>
          <div className="stats">
            <div><b>{quota.unlimited ? '不限' : quota.remaining}</b><span>剩余</span></div>
            <div><b>{quota.used}</b><span>已用</span></div>
            <div><b>{quota.bonus}</b><span>额外额度</span></div>
          </div>
          {retentionHours > 0 && <p className="g-note">未收藏的图片保留 {retentionHours >= 24 && retentionHours % 24 === 0 ? `${retentionHours / 24} 天` : `${retentionHours} 小时`}，收藏后长期保存</p>}
        </section>
      )}
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
        <h3>账户</h3>
        <div className="g-col">
          <div className="g-row"><span className="g-k">用户名</span><span>{me.username}</span></div>
          <div className="g-row"><span className="g-k">昵称</span>
            <input className="input g-input" value={nick} onChange={e => setNick(e.target.value)} placeholder={me.username} />
            {nick.trim() !== me.nickname && <button className="btn btn-secondary" onClick={saveNick}>保存</button>}</div>
          <div className="g-row"><span className="g-k">修改密码</span>
            <input className="input g-input" type="password" autoComplete="current-password" value={oldPw} onChange={e => setOldPw(e.target.value)} placeholder="当前密码" />
            <input className="input g-input" type="password" autoComplete="new-password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="新密码，至少 6 位" />
            {oldPw && newPw.length >= 6 && <button className="btn btn-secondary" onClick={savePw}>修改</button>}</div>
        </div>
        <div className="g-row g-foot">
          <span className="grow" />
          <button className="btn btn-secondary" onClick={logout}><LogOut size={16} />退出登录</button>
        </div>
      </section>
    </div>
  )
}
