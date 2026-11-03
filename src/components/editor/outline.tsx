import { useEffect, useMemo, useState, type RefObject } from "react"
import { cn } from "@/lib/utils"

/** Headings (#, ##, ###) in a note's markdown, skipping code blocks. */
export function headingsOf(md: string) {
  const out: { level: number; text: string }[] = []
  let fence = false
  for (const line of md.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (fence) continue
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (m) out.push({ level: m[1].length, text: m[2].replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/[*_`~]|\[@[^\]]*\]/g, "").trim() })
  }
  return out
}

/**
 * The note's headings in the margin, on screens wide enough for it. Click one to scroll there;
 * the one you're reading is marked.
 */
export function Outline({ markdown, scroller }: { markdown: string; scroller: RefObject<HTMLElement | null> }) {
  const headings = useMemo(() => headingsOf(markdown), [markdown])
  const [wide, setWide] = useState(false)
  const [active, setActive] = useState(-1)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWide(el.clientWidth >= 1200))
    ro.observe(el)
    return () => ro.disconnect()
  }, [scroller])

  const elements = () =>
    Array.from(scroller.current?.querySelectorAll<HTMLElement>("[data-slate-editor] :is(h1, h2, h3)") ?? [])

  useEffect(() => {
    const el = scroller.current
    if (!el || !wide) return
    const onScroll = () => {
      const top = el.getBoundingClientRect().top + 80
      let i = -1
      elements().forEach((h, n) => {
        if (h.getBoundingClientRect().top <= top) i = n
      })
      setActive(i)
    }
    onScroll()
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => el.removeEventListener("scroll", onScroll)
  }, [scroller, wide, headings]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!wide || headings.length < 2) return null
  const min = Math.min(...headings.map((h) => h.level))
  return (
    <nav aria-label="Outline" className="absolute top-20 right-6 z-10 max-h-[calc(100%-8rem)] w-52 overflow-y-auto font-sans">
      <ul className="space-y-0.5 border-l">
        {headings.map((h, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => {
                const el = scroller.current
                const target = elements()[i]
                // Leave room for the sticky toolbar.
                if (el && target) el.scrollBy({ top: target.getBoundingClientRect().top - el.getBoundingClientRect().top - 72, behavior: "smooth" })
              }}
              className={cn(
                "-ml-px block w-full truncate border-l py-0.5 pr-1 text-left text-xs text-muted-foreground hover:text-foreground",
                i === active ? "border-foreground text-foreground" : "border-transparent",
              )}
              style={{ paddingLeft: 10 + (h.level - min) * 10 }}
              title={h.text}
            >
              {h.text || "Untitled"}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}
