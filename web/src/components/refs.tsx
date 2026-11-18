import { useEffect, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import { uploadRef } from '../api'
import type { RefImg } from '../store'
import { useStore } from '../store'
import { Spinner } from './ui'

/** 参考图上传：拖拽、粘贴、选择文件 */
export function useRefUpload(refs: RefImg[], onChange: (r: RefImg[]) => void, max: number, pasteEnabled = true) {
  const { toast } = useStore()
  const input = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(0)
  const refsRef = useRef(refs)
  refsRef.current = refs

  const add = async (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith('image/'))
    if (!imgs.length) return
    if (max <= 0) { toast('当前渠道不支持参考图', 'info'); return }
    const room = max - refsRef.current.length
    if (room <= 0) { toast(`当前渠道最多 ${max} 张参考图`, 'info'); return }
    const take = imgs.slice(0, room)
    if (imgs.length > room) toast(`当前渠道最多 ${max} 张参考图`, 'info')
    setBusy(b => b + take.length)
    for (const f of take) {
      try {
        const r = await uploadRef(f)
        refsRef.current = [...refsRef.current, r]
        onChange(refsRef.current)
      } catch (e: any) { toast(e.message, 'err') }
      finally { setBusy(b => b - 1) }
    }
  }

  useEffect(() => {
    if (!pasteEnabled) return
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || [])
      if (files.some(f => f.type.startsWith('image/'))) { e.preventDefault(); add(files) }
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  })

  const fileInput = <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { add(Array.from(e.target.files || [])); e.target.value = '' }} />
  return { add, busy, pick: () => input.current?.click(), fileInput }
}

export function RefThumbs({ refs, busy, onChange }: { refs: RefImg[]; busy: number; onChange: (r: RefImg[]) => void }) {
  return (
    <>
      {refs.map(r => (
        <div className="ref" key={r.id}>
          <img src={r.url} alt="" />
          <button className="ref-x" onClick={() => onChange(refs.filter(x => x.id !== r.id))} aria-label="移除"><X size={12} /></button>
        </div>
      ))}
      {Array.from({ length: busy }).map((_, i) => <div className="ref is-busy" key={'b' + i}><Spinner /></div>)}
    </>
  )
}

/** 对比页用的参考图行 */
export function RefDrop({ refs, onChange, max }: { refs: RefImg[]; onChange: (r: RefImg[]) => void; max: number }) {
  const up = useRefUpload(refs, onChange, max, false)
  const [over, setOver] = useState(false)
  const disabled = max <= 0
  return (
    <div className={`refs ${over ? 'is-over' : ''}`}
      onDragOver={e => { if (disabled) return; e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) up.add(Array.from(e.dataTransfer.files)) }}>
      <RefThumbs refs={refs} busy={up.busy} onChange={onChange} />
      {refs.length + up.busy < max && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={up.pick}><ImagePlus size={16} />参考图<span className="btn-count">{refs.length}/{max}</span></button>
      )}
      {up.fileInput}
    </div>
  )
}
