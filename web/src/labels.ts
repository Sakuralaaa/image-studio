import type { Caps, Params } from './api'

export const capLabels: Record<keyof Caps, string> = {
  size: '尺寸', aspect: '比例', resolution: '分辨率', quality: '质量', n: '张数',
  format: '输出格式', compression: '压缩', background: '背景', moderation: '审核',
  response: '返回方式', refs: '参考图',
}

export const modeLabels: Record<string, string> = {
  native: '原生发送', prompt: '写进提示词', off: '不用', loop: '逐张请求',
  multipart: '表单上传', json: '内嵌数据',
}

const valueMap: Record<string, string> = {
  auto: '自动', low: '低', medium: '中', high: '高', xhigh: '超高', max: '极致', standard: '标准', hd: '高清',
  transparent: '透明', opaque: '不透明', url: '链接', b64_json: '内嵌数据',
  png: 'PNG', jpeg: 'JPEG', webp: 'WEBP', '1k': '1K', '2k': '2K', '4k': '4K', '1.5k': '1.5K',
}
export const moderationMap: Record<string, string> = { auto: '标准', low: '宽松' }

export function valueLabel(key: string, v: string): string {
  if (key === 'moderation') return moderationMap[v] || v
  if (key === 'size') return v === 'auto' ? '自动' : v.replace('x', '×')
  return valueMap[v] ?? v
}

export const paramOrder: (keyof Params)[] = ['aspect', 'size', 'resolution', 'quality', 'n', 'format', 'compression', 'background', 'moderation']
export const paramLabels: Record<string, string> = {
  aspect: '比例', size: '尺寸', resolution: '分辨率', quality: '质量', n: '张数',
  format: '格式', compression: '压缩', background: '背景', moderation: '审核',
}

export function describeParams(p: Params): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = []
  for (const k of paramOrder) {
    const v = (p as any)[k]
    if (v === undefined || v === '' || v === 0) continue
    out.push({ k: paramLabels[k], v: k === 'n' || k === 'compression' ? String(v) + (k === 'compression' ? '%' : ' 张') : valueLabel(k, String(v)) })
  }
  return out
}

export const apiTypeLabels: Record<string, string> = { images: '生图接口', chat: '对话出图' }

export function fmtBytes(n: number) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 2 : 1) + ' MB'
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB'
}

export function fmtDuration(ms: number) {
  if (!ms) return '—'
  if (ms < 1000) return ms + ' 毫秒'
  const s = ms / 1000
  if (s < 60) return s.toFixed(1) + ' 秒'
  return Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒'
}

export function fmtTime(ms: number) {
  const d = new Date(ms)
  const now = new Date()
  const pad = (x: number) => String(x).padStart(2, '0')
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === now.toDateString()) return '今天 ' + hm
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return '昨天 ' + hm
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`
}

export function ratioOf(w: number, h: number) {
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const x = g(w, h) || 1
  return `${w / x}:${h / x}`
}

export function aspectNumber(r?: string, size?: string): number {
  if (r && r.includes(':')) {
    const [a, b] = r.split(':').map(Number)
    if (a > 0 && b > 0) return a / b
  }
  if (size && size.includes('x')) {
    const [a, b] = size.split('x').map(Number)
    if (a > 0 && b > 0) return a / b
  }
  return 1
}
