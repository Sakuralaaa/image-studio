import type { Channel, Params, Cap } from '../api'
import { valueLabel } from '../labels'
import { Segmented, Stepper } from './ui'
import { Route as RouteIcon } from 'lucide-react'

const on = (c?: Cap) => !!c && c.mode !== 'off' && c.mode !== undefined
const vals = (c?: Cap) => (c?.values || []).filter(Boolean)

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

function RatioShape({ r }: { r: string }) {
  const [a, b] = r.split(/[:x]/).map(Number)
  const k = a && b ? a / b : 1
  const w = k >= 1 ? 18 : 18 * k
  const h = k >= 1 ? 18 / k : 18
  return <span className="ratio-shape"><i style={{ width: Math.max(5, w), height: Math.max(5, h) }} /></span>
}

export function ParamControls({ channel, params, onChange, compact }: {
  channel?: Channel; params: Params; onChange: (p: Params) => void; compact?: boolean
}) {
  if (!channel) return null
  const c = channel.caps
  const set = (patch: Params) => onChange({ ...params, ...patch })
  const toolPath = channel.tool_path_at > 0
  const nMax = c.n?.mode === 'off' ? 1 : Math.max(1, c.n?.max || 1)
  const rows: JSX.Element[] = []

  if (on(c.aspect) && vals(c.aspect).length) rows.push(
    <div className="prow" key="aspect">
      <div className="prow-label">比例{c.aspect.mode === 'prompt' && <span className="prow-tag">提示词</span>}</div>
      <div className="ratio-grid">
        {vals(c.aspect).map(v => (
          <button type="button" key={v} className={`ratio ${params.aspect === v ? 'is-on' : ''}`} onClick={() => set({ aspect: v })}>
            <RatioShape r={v} /><span>{valueLabel('aspect', v)}</span>
          </button>
        ))}
      </div>
    </div>)

  if (on(c.size) && vals(c.size).length) rows.push(
    <div className="prow" key="size">
      <div className="prow-label">尺寸{c.size.mode === 'prompt' && <span className="prow-tag">提示词</span>}</div>
      <div className="ratio-grid is-size">
        {vals(c.size).map(v => (
          <button type="button" key={v} className={`ratio ${params.size === v ? 'is-on' : ''}`} onClick={() => set({ size: v })}>
            {v === 'auto' ? <span className="ratio-shape"><i className="is-auto" /></span> : <RatioShape r={v} />}<span>{valueLabel('size', v)}</span>
          </button>
        ))}
      </div>
    </div>)

  if (on(c.resolution) && vals(c.resolution).length) rows.push(
    <div className={`prow ${toolPath ? 'is-locked' : ''}`} key="res">
      <div className="prow-label">分辨率{c.resolution.mode === 'prompt' && <span className="prow-tag">提示词</span>}</div>
      <Segmented value={params.resolution || ''} disabled={toolPath} options={vals(c.resolution).map(v => ({ value: v, label: valueLabel('resolution', v) }))} onChange={v => set({ resolution: v })} />
    </div>)

  if (on(c.quality) && vals(c.quality).length) rows.push(
    <div className={`prow ${toolPath ? 'is-locked' : ''}`} key="q">
      <div className="prow-label">质量{c.quality.mode === 'prompt' && <span className="prow-tag">提示词</span>}</div>
      <Segmented value={params.quality || ''} disabled={toolPath} wrap options={vals(c.quality).map(v => ({ value: v, label: valueLabel('quality', v) }))} onChange={v => set({ quality: v })} />
    </div>)

  if (toolPath && (on(c.resolution) || on(c.quality))) rows.push(
    <div className="toolpath" key="tp"><RouteIcon size={14} />当前走对话工具链路</div>)

  if (!compact) rows.push(
    <div className="prow prow-inline" key="n">
      <div className="prow-label">张数</div>
      <Stepper value={params.n || 1} min={1} max={nMax} disabled={nMax <= 1} onChange={v => set({ n: v })} />
    </div>)

  if (on(c.format) && vals(c.format).length) rows.push(
    <div className="prow" key="fmt">
      <div className="prow-label">格式</div>
      <Segmented value={params.format || ''} options={vals(c.format).map(v => ({ value: v, label: valueLabel('format', v) }))} onChange={v => set({ format: v, ...(on(c.compression) && (v === 'jpeg' || v === 'webp') && !params.compression ? { compression: 90 } : {}) })} />
    </div>)

  if (on(c.compression) && (params.format === 'jpeg' || params.format === 'webp')) rows.push(
    <div className="prow prow-inline" key="cmp">
      <div className="prow-label">压缩质量</div>
      <div className="range">
        <input type="range" min={10} max={100} step={5} value={params.compression || 90} onChange={e => set({ compression: Number(e.target.value) })} />
        <span className="range-val">{params.compression || 90}%</span>
      </div>
    </div>)

  if (on(c.background) && vals(c.background).length) rows.push(
    <div className="prow" key="bg">
      <div className="prow-label">背景{c.background.mode === 'prompt' && <span className="prow-tag">提示词</span>}</div>
      <Segmented value={params.background || ''} options={vals(c.background).map(v => ({ value: v, label: valueLabel('background', v) }))} onChange={v => set({ background: v })} />
    </div>)

  if (on(c.moderation) && vals(c.moderation).length) rows.push(
    <div className="prow" key="mod">
      <div className="prow-label">审核</div>
      <Segmented value={params.moderation || ''} options={vals(c.moderation).map(v => ({ value: v, label: valueLabel('moderation', v) }))} onChange={v => set({ moderation: v })} />
    </div>)

  return <div className={`params ${compact ? 'is-compact' : ''}`}>{rows}</div>
}
