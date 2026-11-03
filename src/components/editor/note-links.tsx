import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { FilePlusIcon, FileTextIcon } from "lucide-react"
import { TextApi, type DecoratedRange } from "platejs"
import { PlateLeaf, createPlatePlugin, useEditorRef, useEditorSelector, type PlateLeafProps } from "platejs/react"
import type { NoteFile } from "@/lib/api"
import { WIKI_LINK, linkTarget, resolveLink } from "@/lib/wikilinks"
import { cn } from "@/lib/utils"

/** What links in a note need: the project's notes, and a way to open (or create) one. */
export interface NoteLinks {
  notes: NoteFile[]
  /** The note being edited, left out of suggestions. */
  current?: string
  open: (target: string) => void
  /** Make an empty note, for a link to one that doesn't exist yet. */
  create: (name: string) => void
}
export const NoteLinksContext = createContext<NoteLinks | null>(null)

/** Shows `[[Note]]` as a link. Decoration only: the markdown stays as typed. */
export const WikiLinkPlugin = createPlatePlugin({
  key: "wikiLink",
  node: { isLeaf: true, isDecoration: true },
  decorate: ({ entry: [node, path], type }) => {
    if (!TextApi.isText(node) || !node.text.includes("[[")) return []
    const ranges: DecoratedRange[] = []
    for (const m of node.text.matchAll(WIKI_LINK)) {
      ranges.push({
        anchor: { path, offset: m.index },
        focus: { path, offset: m.index + m[0].length },
        [type]: true,
      } as DecoratedRange)
    }
    return ranges
  },
}).withComponent(WikiLinkLeaf)

function WikiLinkLeaf(props: PlateLeafProps) {
  const links = useContext(NoteLinksContext)
  const text = String((props.leaf as { text?: string }).text ?? "")
  const target = linkTarget(text.replace(/^\[\[/, "").replace(/\]\]$/, ""))
  const found = links ? resolveLink(target, links.notes) : undefined
  return (
    <PlateLeaf
      {...props}
      className={cn(
        "cursor-pointer rounded-sm underline underline-offset-[3px]",
        found ? "text-primary decoration-primary/40" : "text-muted-foreground decoration-dashed",
      )}
      attributes={{
        ...props.attributes,
        title: found ? `Open ${found.name}` : `Create “${target.trim()}”`,
        onClick: (e: React.MouseEvent) => {
          if (!links || !target.trim()) return
          e.preventDefault()
          links.open(target.trim())
        },
      }}
    >
      {props.children}
    </PlateLeaf>
  )
}

const OPEN = /\[\[([^[\]\n|]*)$/

/** Typing `[[` lists the project's notes; Enter or Tab links the chosen one. */
export function NoteLinkMenu() {
  const editor = useEditorRef()
  const links = useContext(NoteLinksContext)
  // Where the open `[[` is, and what's typed after it.
  const at = useEditorSelector((ed) => {
    const sel = ed.selection
    if (!sel || sel.anchor.offset !== sel.focus.offset || sel.anchor.path.join() !== sel.focus.path.join()) return null
    const node = ed.api.node(sel.anchor.path)?.[0]
    if (!node || !TextApi.isText(node)) return null
    const m = OPEN.exec(node.text.slice(0, sel.anchor.offset))
    if (!m) return null
    return { path: sel.anchor.path, offset: sel.anchor.offset, query: m[1], after: node.text.slice(sel.anchor.offset, sel.anchor.offset + 2) }
  }, [])
  const atKey = at ? `${at.path.join()}:${at.offset - at.query.length}` : ""
  const [dismissed, setDismissed] = useState("")
  const [active, setActive] = useState(0)

  const options = useMemo(() => {
    if (!at || !links) return []
    const q = at.query.trim().toLowerCase()
    const notes = links.notes.filter((n) => n.path !== links.current)
    const starts = notes.filter((n) => n.name.toLowerCase().startsWith(q))
    const has = notes.filter((n) => !starts.includes(n) && (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)))
    const list: { name: string; folder?: string; create?: boolean }[] = [...starts, ...has].slice(0, 8).map((n) => {
      const folder = n.path.includes("/") ? n.path.replace(/\/[^/]*$/, "") : undefined
      return { name: n.name, folder }
    })
    if (q && !notes.some((n) => n.name.toLowerCase() === q)) list.push({ name: at.query.trim(), create: true })
    return list
  }, [at?.query, links]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = !!at && !!links && options.length > 0 && dismissed !== atKey
  useEffect(() => setActive(0), [at?.query])

  const pick = (i: number) => {
    const o = options[i]
    if (!o || !at) return
    const start = at.offset - at.query.length - 2
    const end = at.offset + (at.after === "]]" ? 2 : 0)
    editor.tf.select({ anchor: { path: at.path, offset: start }, focus: { path: at.path, offset: end } })
    editor.tf.insertText(`[[${o.name}]]`)
    editor.tf.focus()
    if (o.create) links?.create(o.name)
  }

  const state = useRef({ open, options, active, pick, atKey })
  state.current = { open, options, active, pick, atKey }
  useEffect(() => {
    // Capture phase, so the editor never sees the keys the menu uses.
    const onKey = (e: KeyboardEvent) => {
      const s = state.current
      if (!s.open) return
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const d = e.key === "ArrowDown" ? 1 : -1
        setActive((a) => (a + d + s.options.length) % s.options.length)
      } else if (e.key === "Enter" || e.key === "Tab") s.pick(s.active)
      else if (e.key === "Escape") setDismissed(s.atKey)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [])

  if (!open) return null
  const rect = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null
  if (!rect || (!rect.top && !rect.left)) return null
  const below = rect.bottom + 260 < window.innerHeight
  return createPortal(
    <div
      role="listbox"
      className="fixed z-50 w-72 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
      style={{ left: Math.min(rect.left, window.innerWidth - 296), ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }) }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {options.map((o, i) => (
        <div
          key={(o.create ? "+" : "") + (o.folder ?? "") + o.name}
          role="option"
          aria-selected={i === active}
          onMouseEnter={() => setActive(i)}
          onClick={() => pick(i)}
          className={cn(
            "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
            i === active && "bg-accent text-accent-foreground",
          )}
        >
          {o.create ? <FilePlusIcon className="size-4 text-muted-foreground" /> : <FileTextIcon className="size-4 text-muted-foreground" />}
          <span className="truncate">{o.create ? `New note “${o.name}”` : o.name}</span>
          {o.folder && <span className="ml-auto truncate text-xs text-muted-foreground">{o.folder}</span>}
        </div>
      ))}
    </div>,
    document.body,
  )
}
