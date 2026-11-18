export type CapMode = 'native' | 'prompt' | 'loop' | 'off' | 'multipart' | 'json'
export interface Cap { mode: CapMode; values?: string[]; max?: number; default?: string }
export interface Caps {
  size: Cap; aspect: Cap; resolution: Cap; quality: Cap; n: Cap; format: Cap
  compression: Cap; background: Cap; moderation: Cap; response: Cap; refs: Cap
}
export interface Channel {
  id: number; name: string; base_url: string; api_key?: string; key_tail: string
  api_type: 'images' | 'chat'; models: string[]; caps: Caps; sort: number
  tool_path_at: number; created_at: number
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
}
export interface Facet { name: string; count: number }

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
