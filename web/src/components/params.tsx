import type { Channel, Params, Cap } from '../api'
import { valueLabel } from '../labels'
import { Segmented, Stepper, type Opt } from './ui'

const on = (c?: Cap) => !!c && c.mode !== 'off' && c.mode !== undefined
const vals = (c?: Cap) => (c?.values || []).filter(Boolean)
const COMMON_RATIOS = ['1:1', '3:4', '4:3', '9:16', '16:9']

/** 根据渠道能力档案，补齐/修正参数默认值 */
export function normalizeParams(ch: Channel | undefined, p: Params): Params {
  if (!ch) return p
  const c = ch.caps
  const out: Params = { ...p }
  const fix = (key: keyof Params, cap: Cap) => {
    const vs = vals(cap)
    if (!on(cap) || !vs.length) { delete out[key]; return }
    if (!vs.includes(String(out[key] ?? ''))) (out as any)[key] = cap.default && vs.includes(cap.default) ? cap.default : vs[0]
  }
  fix('aspect', c.aspect); fix('size', c.size); fix('resolution', c.resolution); fix('quality', c.quality)
  fix('format', c.format); fix('background', c.background); fix('moderation', c.moderation)
  const max = c.n?.mode === 'off' ? 1 : Math.max(1, c.n?.max || 1)
  out.n = Math.min(Math.max(1, out.n || 1), max)
  if (!(on(c.compression) && (out.format === 'jpeg' || out.format === 'webp'))) delete out.compression
  else if (!out.compression) out.compression = 90
  return out
}

/** 常用值直接平铺，其余放进「更多」 */
function split(values: string[], key: string, common?: string[], keep = 4): { main: Opt[]; more: Opt[] } {
  const toOpt = (v: string): Opt => ({ value: v, label: valueLabel(key, v), glyph: key === 'aspect' || key === 'size' ? v : undefined })
  if (common) {
    const main = common.filter(v => values.includes(v))
    const rest = values.filter(v => !main.includes(v))
    if (main.length < 2) return { main: values.slice(0, keep).map(toOpt), more: values.slice(keep).map(toOpt) }
    return { main: main.map(toOpt), more: rest.map(toOpt) }
  }
  if (values.length <= keep) return { main: values.map(toOpt), more: [] }
  return { main: values.slice(0, keep - 1).map(toOpt), more: values.slice(keep - 1).map(toOpt) }
}

export function sizeLabel(v: string) { return v === 'auto' ? '自动' : v.replace('x', '×') }

export function paramSummary(channel: Channel | undefined, p: Params) {
  const parts: string[] = []
  if (p.aspect) parts.push(p.aspect)
  else if (p.size) parts.push(sizeLabel(p.size))
  if (p.quality) parts.push(valueLabel('quality', p.quality) + '质')
  parts.push(`${p.n || 1} 张`)
  return channel ? parts.join(' · ') : '参数'
}

export function ParamControls({ channel, params, onChange, compact, size = 'md' }: {
  channel?: Channel; params: Params; onChange: (p: Params) => void; compact?: boolean; size?: 'sm' | 'md'
}) {
  if (!channel) return null
  const c = channel.caps
  const set = (patch: Params) => onChange({ ...params, ...patch })
  const toolPath = channel.tool_path_at > 0
  const nMax = c.n?.mode === 'off' ? 1 : Math.max(1, c.n?.max || 1)
  const rows: JSX.Element[] = []
  const row = (key: string, label: string, ctl: JSX.Element, locked = false) => (
    <div className={`prow ${locked ? 'is-locked' : ''}`} key={key} title={locked ? '当前走对话工具链路' : undefined}>
      <div className="prow-label">{label}</div>{ctl}
    </div>
  )

  if (on(c.aspect) && vals(c.aspect).length) {
    const s = split(vals(c.aspect), 'aspect', COMMON_RATIOS)
    rows.push(row('aspect', '比例', <Segmented size={size} value={params.aspect || ''} options={s.main} more={s.more} onChange={v => set({ aspect: v })} />))
  }
  if (on(c.size) && vals(c.size).length) {
    const s = split(vals(c.size), 'size', undefined, 4)
    rows.push(row('size', '尺寸', <Segmented size={size} value={params.size || ''} options={s.main.map(o => ({ ...o, label: sizeLabel(o.value) }))} more={s.more.map(o => ({ ...o, label: sizeLabel(o.value) }))} moreCols={2} onChange={v => set({ size: v })} />))
  }
  if (on(c.resolution) && vals(c.resolution).length) rows.push(row('res', '分辨率',
    <Segmented size={size} value={params.resolution || ''} disabled={toolPath} options={vals(c.resolution).map(v => ({ value: v, label: valueLabel('resolution', v) }))} onChange={v => set({ resolution: v })} />, toolPath))
  if (on(c.quality) && vals(c.quality).length) rows.push(row('q', '质量',
    <Segmented size={size} value={params.quality || ''} disabled={toolPath} options={vals(c.quality).map(v => ({ value: v, label: valueLabel('quality', v) }))} onChange={v => set({ quality: v })} />, toolPath))
  if (on(c.format) && vals(c.format).length) rows.push(row('fmt', '格式',
    <Segmented size={size} value={params.format || ''} options={vals(c.format).map(v => ({ value: v, label: valueLabel('format', v) }))}
      onChange={v => set({ format: v, ...(on(c.compression) && (v === 'jpeg' || v === 'webp') && !params.compression ? { compression: 90 } : {}) })} />))
  if (on(c.compression) && (params.format === 'jpeg' || params.format === 'webp')) rows.push(row('cmp', '压缩质量',
    <div className="range">
      <input type="range" min={10} max={100} step={5} value={params.compression || 90} onChange={e => set({ compression: Number(e.target.value) })} />
      <span className="range-val">{params.compression || 90}%</span>
    </div>))
  if (on(c.background) && vals(c.background).length) rows.push(row('bg', '背景',
    <Segmented size={size} value={params.background || ''} options={vals(c.background).map(v => ({ value: v, label: valueLabel('background', v) }))} onChange={v => set({ background: v })} />))
  if (on(c.moderation) && vals(c.moderation).length) rows.push(row('mod', '审核',
    <Segmented size={size} value={params.moderation || ''} options={vals(c.moderation).map(v => ({ value: v, label: valueLabel('moderation', v) }))} onChange={v => set({ moderation: v })} />))
  if (!compact) rows.push(
    <div className="prow prow-inline" key="n">
      <div className="prow-label">张数</div>
      <Stepper value={params.n || 1} min={1} max={nMax} disabled={nMax <= 1} onChange={v => set({ n: v })} />
    </div>)

  return <div className={`params params-${size}`}>{rows}</div>
}
