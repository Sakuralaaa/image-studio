import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type Img } from '../api'

export function useImages(query: Record<string, string>, tick: number) {
  const [images, setImages] = useState<Img[]>([])
  const [next, setNext] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v)).toString()
  const qsRef = useRef(qs)
  qsRef.current = qs
  const busy = useRef(false)

  const load = useCallback(async (cursor: number, mode: 'replace' | 'append' | 'merge') => {
    const myQs = qsRef.current
    busy.current = true
    setLoading(true)
    try {
      const res = await api<{ images: Img[]; next: number }>(`/api/images?limit=40${myQs ? '&' + myQs : ''}${cursor ? '&cursor=' + cursor : ''}`)
      if (myQs !== qsRef.current) return
      if (mode === 'replace') { setImages(res.images); setNext(res.next) }
      else if (mode === 'append') { setImages(l => [...l, ...res.images.filter(x => !l.some(y => y.id === x.id))]); setNext(res.next) }
      else setImages(l => {
        const fresh = res.images.filter(x => !l.some(y => y.id === x.id))
        const updated = l.map(y => res.images.find(x => x.id === y.id) || y)
        if (!l.length) setNext(res.next)
        return [...fresh, ...updated]
      })
    } finally {
      busy.current = false
      setLoading(false)
      setLoaded(true)
    }
  }, [])

  useEffect(() => { setLoaded(false); load(0, 'replace') }, [qs])
  useEffect(() => { if (tick) load(0, 'merge') }, [tick])

  const more = useCallback(() => { if (next && !busy.current) load(next, 'append') }, [next, load])
  const update = useCallback((img: Img) => setImages(l => l.map(x => (x.id === img.id ? img : x))), [])
  const remove = useCallback((id: number) => setImages(l => l.filter(x => x.id !== id)), [])
  return { images, setImages, next, loading, loaded, more, update, remove }
}

export function useSentinel(onHit: () => void, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const cb = useRef(onHit)
  cb.current = onHit
  useEffect(() => {
    if (!enabled || !ref.current) return
    const io = new IntersectionObserver(es => es.some(e => e.isIntersecting) && cb.current(), { rootMargin: '800px 0px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [enabled])
  return ref
}
