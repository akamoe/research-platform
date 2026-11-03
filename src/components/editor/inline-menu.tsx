import { useEffect, useRef, useState, type ComponentType } from "react"
import { createPortal } from "react-dom"
import { TextApi, type Path } from "platejs"
import { useEditorSelector } from "platejs/react"
import { cn } from "@/lib/utils"

/** Where a typed trigger (like `[[` or `/`) is: its text node, where it starts, and what's typed after it. */
export interface TriggerAt {
  path: Path
  /** Offset of the trigger's first character. */
  start: number
  /** The cursor. */
  offset: number
  query: string
  /** The two characters after the cursor, e.g. a `]]` to replace too. */
  after: string
  /** Stable while the student keeps typing the same trigger. */
  key: string
}

/** Watches the text before the cursor. `re` must end in `$` and capture the query as group 1. */
export function useTrigger(re: RegExp): TriggerAt | null {
  return useEditorSelector(
    (ed) => {
      const sel = ed.selection
      if (!sel || sel.anchor.offset !== sel.focus.offset || sel.anchor.path.join() !== sel.focus.path.join()) return null
      const node = ed.api.node(sel.anchor.path)?.[0]
      if (!node || !TextApi.isText(node)) return null
      const m = re.exec(node.text.slice(0, sel.anchor.offset))
      if (!m) return null
      const start = sel.anchor.offset - m[0].length
      return {
        path: sel.anchor.path,
        start,
        offset: sel.anchor.offset,
        query: m[1] ?? "",
        after: node.text.slice(sel.anchor.offset, sel.anchor.offset + 2),
        key: `${sel.anchor.path.join()}:${start}`,
      }
    },
    [re],
    { equalityFn: (a, b) => a?.key === b?.key && a?.offset === b?.offset && a?.query === b?.query && a?.after === b?.after },
  )
}

export interface MenuItem {
  key: string
  label: string
  icon?: ComponentType<{ className?: string }>
  /** Shown faint on the right, e.g. a folder or a year. */
  hint?: string
}

/**
 * A small list under the cursor, like shadcn's Command but keeping focus in the note.
 * Arrow keys move, Enter or Tab picks, Escape closes it until the trigger is typed again.
 */
export function InlineMenu<T extends MenuItem>({
  at,
  items,
  onPick,
  empty,
}: {
  at: TriggerAt | null
  items: T[]
  onPick: (item: T, at: TriggerAt) => void
  /** Shown when nothing matches; without it the menu hides. */
  empty?: string
}) {
  const [dismissed, setDismissed] = useState("")
  const [active, setActive] = useState({ query: "", i: 0 })
  const index = at && active.query === at.query ? Math.min(active.i, Math.max(0, items.length - 1)) : 0
  const open = !!at && dismissed !== at.key && (items.length > 0 || !!empty)

  const state = useRef({ open, items, index, at, onPick })
  useEffect(() => {
    state.current = { open, items, index, at, onPick }
  })
  useEffect(() => {
    // Capture phase, so the editor never sees the keys the menu uses.
    const onKey = (e: KeyboardEvent) => {
      const s = state.current
      if (!s.open || !s.at) return
      const n = s.items.length
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && n) {
        const d = e.key === "ArrowDown" ? 1 : -1
        setActive({ query: s.at.query, i: (s.index + d + n) % n })
      } else if ((e.key === "Enter" || e.key === "Tab") && n) s.onPick(s.items[s.index], s.at)
      else if (e.key === "Escape") setDismissed(s.at.key)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  if (!open || !at) return null
  const sel = window.getSelection()
  const rect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null
  if (!rect || (!rect.top && !rect.left)) return null
  const below = rect.bottom + 300 < window.innerHeight
  return createPortal(
    <div
      role="listbox"
      className="fixed z-50 max-h-72 w-72 overflow-y-auto rounded-md border bg-popover p-1 font-sans text-popover-foreground shadow-md"
      style={{
        left: Math.min(rect.left, window.innerWidth - 296),
        ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {!items.length && <div className="px-2 py-1.5 text-sm text-muted-foreground">{empty}</div>}
      {items.map((o, i) => {
        const Icon = o.icon
        return (
          <div
            key={o.key}
            role="option"
            aria-selected={i === index}
            ref={i === index ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            onMouseEnter={() => setActive({ query: at.query, i })}
            onClick={() => onPick(o, at)}
            className={cn(
              "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
              i === index && "bg-accent text-accent-foreground",
            )}
          >
            {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="truncate">{o.label}</span>
            {o.hint && <span className="ml-auto shrink-0 truncate pl-2 text-xs text-muted-foreground">{o.hint}</span>}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
