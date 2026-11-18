export type CapMode = 'native' | 'prompt' | 'loop' | 'off' | 'multipart' | 'json'
export interface Cap { mode: CapMode; values?: string[]; max?: number; default?: string }
export interface Caps {
  size: Cap; aspect: Cap; resolution: Cap; quality: Cap; n: Cap; format: Cap
  compression: Cap; background: Cap; moderation: Cap; response: Cap; refs: Cap
}
export interface Channel {
  id: number; name: string; base_url: string; api_key?: string; key_tail: string
  api_type: 'images' | 'chat'; models: string[]; caps: Caps; sort: number
  tool_path_at: number; created_at: number; hidden?: boolean
}
export interface Preset { key: string; name: string; base_url: string; api_type: 'images' | 'chat'; models: string[] | null; caps: Caps }
export interface Params {
  size?: string; aspect?: string; resolution?: string; quality?: string; n?: number
  format?: string; compression?: number; background?: string; moderation?: string
}
export interface Recipe {
  channel_id: number; channel_name: string; api_type: string; model: string
  prompt: string; sent_prompt: string; params: Params; endpoint: string
  duration_ms: number; tool_path: boolean; kind: string; group_id: string; ref_count: number
}
export interface Img {
  id: number; job_id: number; url: string; thumb: string; width: number; height: number
  bytes: number; format: string; favorite: boolean; fav_at: number; album: string
  tags: string[]; created_at: number; recipe: Recipe
  expires_at?: number; user_id?: number; owner?: string
}
export interface Job {
  id: number; kind: string; group_id: string; slot: number; channel_id: number
  channel_name: string; api_type: string; model: string; prompt: string; params: Params
  refs: number[]; sent_prompt: string; endpoint: string
  status: 'queued' | 'running' | 'done' | 'failed'; error: string; tool_path: boolean
  started_at: number; finished_at: number; duration_ms: number; created_at: number; images: Img[]
}
export interface PromptItem {
  id: number; title: string; content: string; is_template: boolean; tags: string[]
  pinned: boolean; use_count: number; created_at: number; updated_at: number
  user_id?: number; owner?: string
}
export interface Facet { name: string; count: number }
export interface Quota { limit: number; used: number; bonus: number; remaining: number; unlimited: boolean }
export interface Me { id: number; username: string; nickname: string; role: 'admin' | 'user'; nsfw: boolean; display: string }
export interface MeInfo { authed: boolean; user?: Me; quota?: Quota; register_mode: 'closed' | 'open' | 'invite'; retention_hours?: number; version: string }
export interface UserRow {
  id: number; username: string; nickname: string; role: 'admin' | 'user'; disabled: boolean; nsfw: boolean
  daily_quota: number; bonus: number; allowed_models: string[]; max_concurrent: number
  created_at: number; last_login_at: number
  display: string; used_today: number; quota: number; images: number; favorites: number; bytes: number; total_gen: number; active_jobs: number
}
export interface Invite { code: string; max_uses: number; used: number; daily_quota: number; bonus: number; note: string; expires_at: number; created_at: number }

export class ApiError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s } }

let onUnauthorized: () => void = () => {}
export function setUnauthorizedHandler(f: () => void) { onUnauthorized = f }

export async function api<T = any>(path: string, opts: { method?: string; body?: any; raw?: BodyInit } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method || (opts.body || opts.raw ? 'POST' : 'GET'), credentials: 'same-origin' }
  if (opts.raw) init.body = opts.raw
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const res = await fetch(path, init)
  if (res.status === 401 && !path.startsWith('/api/login')) onUnauthorized()
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new ApiError((data && data.error) || `请求失败（${res.status}）`, res.status)
  return data as T
}

export function uploadRef(file: File) {
  const fd = new FormData()
  fd.append('file', file)
  return api<{ id: number; url: string }>('/api/refs', { raw: fd })
}

export function downloadPost(path: string, payload: any) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = path
  form.style.display = 'none'
  const input = document.createElement('input')
  input.name = 'payload'
  input.value = JSON.stringify(payload)
  form.appendChild(input)
  document.body.appendChild(form)
  form.submit()
  setTimeout(() => form.remove(), 1000)
}

export interface MarketL10n { title: string; prompt: string; category: string; sub_category?: string }
export interface MarketPrompt {
  id: string; title: string; preview: string; ref_urls: string[] | null; prompt: string; author: string
  link?: string; mode: 'generate' | 'edit'; category: string; sub_category?: string; created?: string
  source: string; nsfw: boolean; l10n?: Record<string, MarketL10n>
}
export interface MarketState {
  items: MarketPrompt[]; fetched_at: number; error: string
  sources: { id: string; label: string; url: string }[]
}
export const marketImg = (u: string) => '/api/market/img?u=' + encodeURIComponent(u)
