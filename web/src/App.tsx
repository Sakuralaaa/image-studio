import { useEffect, useState } from 'react'
import { Wand2, Columns3, BookText, Gem, Settings2, Sun, Moon, ArrowRight } from 'lucide-react'
import { api, setUnauthorizedHandler } from './api'
import { StoreProvider, useStore, type Route } from './store'
import Generate from './pages/Generate'
import Compare from './pages/Compare'
import Prompts from './pages/Prompts'
import Assets from './pages/Assets'
import Settings from './pages/Settings'
import { Spinner } from './components/ui'

const nav: { r: Route; label: string; icon: any }[] = [
  { r: 'generate', label: '生成', icon: Wand2 },
  { r: 'compare', label: '对比', icon: Columns3 },
  { r: 'prompts', label: '提示词', icon: BookText },
  { r: 'assets', label: '资产', icon: Gem },
  { r: 'settings', label: '设置', icon: Settings2 },
]

export default function App() {
  const [state, setState] = useState<'loading' | 'login' | 'ok'>('loading')
  useEffect(() => {
    setUnauthorizedHandler(() => setState('login'))
    api<{ authed: boolean }>('/api/me').then(r => setState(r.authed ? 'ok' : 'login')).catch(() => setState('login'))
  }, [])
  if (state === 'loading') return <div className="boot"><Spinner size={22} /></div>
  if (state === 'login') return <Login onOk={() => setState('ok')} />
  return <StoreProvider><Shell /></StoreProvider>
}

function Seal({ size = 34 }: { size?: number }) {
  return <span className="seal" style={{ width: size, height: size, fontSize: size * 0.56 }}>影</span>
}

function Shell() {
  const { route, go, toasts, theme, setTheme } = useStore()
  const isDark = document.documentElement.dataset.theme === 'dark'
  const Page = { generate: Generate, compare: Compare, prompts: Prompts, assets: Assets, settings: Settings }[route]
  return (
    <div className="shell">
      <div className="rail-col"><aside className="rail">
        <div className="brand" onClick={() => go('generate')}>
          <Seal />
          <div className="brand-text"><b>影室</b><span>生图工作台</span></div>
        </div>
        <nav className="nav">
          {nav.map(n => (
            <button key={n.r} className={`nav-item ${route === n.r ? 'is-on' : ''}`} onClick={() => go(n.r)}>
              <n.icon size={19} strokeWidth={route === n.r ? 2.2 : 1.8} /><span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <button className="nav-item theme-toggle" onClick={() => setTheme(isDark ? 'light' : 'dark')} title={theme === 'system' ? '当前跟随系统' : ''}>
            {isDark ? <Sun size={18} /> : <Moon size={18} />}<span>{isDark ? '浅色' : '深色'}</span>
          </button>
        </div>
      </aside></div>
      <header className="topbar">
        <div className="brand" onClick={() => go('generate')}><Seal size={28} /><b>影室</b></div>
        <button className="icon-btn" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label="切换主题">{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
      </header>
      <main className="main"><Page key={route} /></main>
      <nav className="tabbar">
        {nav.map(n => (
          <button key={n.r} className={`tab ${route === n.r ? 'is-on' : ''}`} onClick={() => go(n.r)}>
            <n.icon size={20} strokeWidth={route === n.r ? 2.2 : 1.8} /><span>{n.label}</span>
          </button>
        ))}
      </nav>
      <div className="toasts">{toasts.map(t => <div key={t.id} className={`toast is-${t.kind}`}>{t.text}</div>)}</div>
    </div>
  )
}

function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await api('/api/login', { body: { password: pw } }); onOk() } catch (e: any) { setErr(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="login">
      <div className="login-art" aria-hidden>
        <div className="la-frame f1" /><div className="la-frame f2" /><div className="la-frame f3" />
      </div>
      <form className="login-card" onSubmit={submit}>
        <Seal size={48} />
        <h1>影室</h1>
        <p className="login-sub">生图工作台</p>
        <input className="input" type="password" autoFocus placeholder="管理员密码" value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div className="login-err">{err}</div>}
        <button className="btn btn-accent btn-block" disabled={busy || !pw}>{busy ? <Spinner /> : <>进入<ArrowRight size={16} /></>}</button>
      </form>
    </div>
  )
}
