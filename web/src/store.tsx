import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, type Channel, type MeInfo, type Me, type Quota, type Params } from './api'
import { fillVars } from './data/snippets'

export type Route = 'generate' | 'compare' | 'assets' | 'settings'
export const routePaths: Record<Route, string> = { generate: '/', compare: '/compare', assets: '/assets', settings: '/settings' }
function routeFromPath(p: string): Route {
  const hit = (Object.keys(routePaths) as Route[]).find(r => routePaths[r] === p)
  return hit || 'generate'
}

export interface RefImg { id: number; url: string }
export interface Composer {
  text: string; chips: string[]; vars: Record<string, string>; refs: RefImg[]
  channelId: number | null; model: string; params: Params
}

const emptyComposer: Composer = { text: '', chips: [], vars: {}, refs: [], channelId: null, model: '', params: { n: 1 } }

export type ThemePref = 'system' | 'light' | 'dark'
interface Toast { id: number; text: string; kind: 'ok' | 'err' | 'info' }

interface Store {
  me: Me; isAdmin: boolean; quota: Quota | null; retentionHours: number; reloadMe: () => void
  route: Route; go: (r: Route) => void
  channels: Channel[]; reloadChannels: () => Promise<void>; channelsLoaded: boolean
  composer: Composer; setComposer: (p: Partial<Composer> | ((c: Composer) => Partial<Composer>)) => void
  addChip: (t: string) => void
  finalPrompt: string
  toast: (text: string, kind?: Toast['kind']) => void
  toasts: Toast[]
  theme: ThemePref; setTheme: (t: ThemePref) => void
  galleryTick: number; bumpGallery: () => void
  market: MarketOpen | null; openMarket: (m?: MarketOpen) => void; closeMarket: () => void
  genView: 'hero' | 'gallery'; setGenView: (v: 'hero' | 'gallery') => void
}
export interface MarketOpen { tab?: 'market' | 'favs' | 'mine' | 'snip'; target?: 'generate' | 'compare' }

const Ctx = createContext<Store>(null as any)
export const useStore = () => useContext(Ctx)

function loadComposer(): Composer {
  try {
    const raw = localStorage.getItem('studio.composer')
    if (raw) return { ...emptyComposer, ...JSON.parse(raw) }
  } catch {}
  return emptyComposer
}

export function applyTheme(t: ThemePref) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  const meta = document.querySelectorAll('meta[name="theme-color"]')
  meta.forEach(m => m.setAttribute('content', dark ? '#0E0F0F' : '#F4F5F1'))
}

export function StoreProvider({ children, info }: { children: ReactNode; info: MeInfo }) {
  const [meInfo, setMeInfo] = useState<MeInfo>(info)
  const reloadMe = useCallback(() => { api<MeInfo>('/api/me').then(x => { if (x.authed) setMeInfo(x) }).catch(() => {}) }, [])
  const [route, setRoute] = useState<Route>(() => routeFromPath(location.pathname))
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelsLoaded, setLoaded] = useState(false)
  const [composer, setComposerState] = useState<Composer>(loadComposer)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [theme, setThemeState] = useState<ThemePref>(() => (localStorage.getItem('studio.theme') as ThemePref) || 'system')
  const [galleryTick, setTick] = useState(0)
  const [market, setMarket] = useState<MarketOpen | null>(null)
  const [genView, setGenViewState] = useState<'hero' | 'gallery'>(() => (sessionStorage.getItem('studio.genview') as any) || 'hero')
  const setGenView = useCallback((v: 'hero' | 'gallery') => { sessionStorage.setItem('studio.genview', v); setGenViewState(v) }, [])
  const openMarket = useCallback((m: MarketOpen = {}) => setMarket(m), [])
  const closeMarket = useCallback(() => setMarket(null), [])
  const tid = useRef(1)

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath(location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = useCallback((r: Route) => {
    if (location.pathname !== routePaths[r]) history.pushState(null, '', routePaths[r])
    setRoute(r)
    window.scrollTo({ top: 0 })
  }, [])

  const reloadChannels = useCallback(async () => {
    const cs = await api<Channel[]>('/api/channels')
    setChannels(cs)
    setLoaded(true)
  }, [])

  useEffect(() => { reloadChannels().catch(() => setLoaded(true)) }, [reloadChannels])

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem('studio.composer', JSON.stringify(composer)), 250)
    return () => clearTimeout(t)
  }, [composer])

  // 选中的渠道被删除时回退
  useEffect(() => {
    if (!channelsLoaded) return
    const ch = channels.find(c => c.id === composer.channelId)
    if (!ch && channels.length) {
      setComposerState(c => ({ ...c, channelId: channels[0].id, model: channels[0].models[0] || '' }))
    }
  }, [channels, channelsLoaded])

  const setComposer = useCallback((p: Partial<Composer> | ((c: Composer) => Partial<Composer>)) => {
    setComposerState(c => ({ ...c, ...(typeof p === 'function' ? p(c) : p) }))
  }, [])

  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = tid.current++
    setToasts(ts => [...ts.slice(-3), { id, text, kind }])
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), kind === 'err' ? 4200 : 2400)
  }, [])

  const addChip = useCallback((t: string) => {
    setComposerState(c => (c.chips.includes(t) ? c : { ...c, chips: [...c.chips, t] }))
  }, [])

  const setTheme = useCallback((t: ThemePref) => {
    localStorage.setItem('studio.theme', t)
    setThemeState(t)
    applyTheme(t)
  }, [])

  useEffect(() => {
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const f = () => applyTheme('system')
    mq.addEventListener('change', f)
    return () => mq.removeEventListener('change', f)
  }, [theme])

  const finalPrompt = useMemo(() => buildPrompt(composer), [composer])
  const bumpGallery = useCallback(() => setTick(x => x + 1), [])

  const me = meInfo.user!
  const value: Store = { me, isAdmin: me.role === 'admin', quota: meInfo.quota || null, retentionHours: meInfo.retention_hours || 0, reloadMe, route, go, channels, reloadChannels, channelsLoaded, composer, setComposer, addChip, finalPrompt, toast, toasts, theme, setTheme, galleryTick, bumpGallery, market, openMarket, closeMarket, genView, setGenView }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function buildPrompt(c: Pick<Composer, 'text' | 'chips' | 'vars'>) {
  const base = fillVars(c.text.trim(), c.vars)
  if (!c.chips.length) return base
  const tail = c.chips.join('，')
  if (!base) return tail
  return base.replace(/[，,。.\s]+$/, '') + '，' + tail
}
