import { useEffect, useState } from 'react'
import { Sun, Moon, ArrowRight, LogOut } from 'lucide-react'
import { api, setUnauthorizedHandler } from './api'
import { StoreProvider, useStore, type Route } from './store'
import Generate from './pages/Generate'
import Compare from './pages/Compare'
import Assets from './pages/Assets'
import Settings from './pages/Settings'
import { Spinner } from './components/ui'
import { PromptMarket } from './components/market'

const nav: { r: Route; label: string }[] = [
  { r: 'generate', label: '生成' },
  { r: 'compare', label: '对比' },
  { r: 'assets', label: '资产' },
  { r: 'settings', label: '设置' },
]

export default function App() {
  const [state, setState] = useState<'loading' | 'login' | 'ok'>('loading')
  useEffect(() => {
    setUnauthorizedHandler(() => setState('login'))
    api<{ authed: boolean }>('/api/me').then(r => setState(r.authed ? 'ok' : 'login')).catch(() => setState('login'))
  }, [])
  if (state === 'loading') return <div className="boot"><Spinner size={20} /></div>
  if (state === 'login') return <Login onOk={() => setState('ok')} />
  return <StoreProvider><Shell /></StoreProvider>
}

export function Seal({ size = 28 }: { size?: number }) {
  return (
    <svg className="seal" width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="seal-g" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="var(--seal-a)" />
          <stop offset="1" stopColor="var(--seal-b)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8.5" fill="url(#seal-g)" />
      <circle cx="16" cy="16" r="11.2" stroke="var(--seal-fg)" strokeWidth="1.9" />
      <path d="M16.00 11.40L27.06 17.78M19.98 13.70L19.98 26.47M19.98 18.30L8.93 24.68M16.00 20.60L4.94 14.22M12.02 18.30L12.02 5.53M12.02 13.70L23.07 7.32" stroke="var(--seal-fg)" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  )
}

function Shell() {
  const { route, go, toasts, setTheme } = useStore()
  const [, force] = useState(0)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 4)
    f(); window.addEventListener('scroll', f, { passive: true })
    return () => window.removeEventListener('scroll', f)
  }, [])
  const isDark = document.documentElement.dataset.theme === 'dark'
  const Page = { generate: Generate, compare: Compare, assets: Assets, settings: Settings }[route]
  const logout = async () => { await api('/api/logout', { method: 'POST' }); location.reload() }
  return (
    <div className={`shell route-${route}`}>
      <header className={`topbar ${scrolled ? 'is-scrolled' : ''}`}>
        <button className="brand" onClick={() => go('generate')} aria-label="影室"><Seal /><b>影室</b></button>
        <nav className="nav">
          {nav.map(n => (
            <button key={n.r} className={`nav-item ${route === n.r ? 'is-on' : ''}`} onClick={() => go(n.r)}>{n.label}</button>
          ))}
        </nav>
        <div className="top-actions">
          <button className="icon-btn" onClick={() => { setTheme(isDark ? 'light' : 'dark'); force(x => x + 1) }} aria-label="切换主题" title={isDark ? '浅色' : '深色'}>{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
          <button className="icon-btn hide-xs" onClick={logout} aria-label="退出登录" title="退出登录"><LogOut size={18} /></button>
        </div>
      </header>
      <main className="main"><Page key={route} /></main>
      <PromptMarket />
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
      <form className="login-card" onSubmit={submit}>
        <Seal size={48} />
        <h1>影室</h1>
        <input className="input" type="password" autoFocus placeholder="管理员密码" value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div className="login-err">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy || !pw}>{busy ? <Spinner /> : <>进入<ArrowRight size={16} /></>}</button>
      </form>
    </div>
  )
}
