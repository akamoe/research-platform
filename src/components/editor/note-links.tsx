import { createContext, useContext, useMemo } from "react"
import { FilePlusIcon, FileTextIcon } from "lucide-react"
import { TextApi, type DecoratedRange } from "platejs"
import { PlateLeaf, createPlatePlugin, useEditorRef, type PlateLeafProps } from "platejs/react"
import { InlineMenu, useTrigger, type MenuItem } from "./inline-menu"
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
  const at = useTrigger(OPEN)
  const query = at?.query

  const items = useMemo(() => {
    if (query === undefined || !links) return []
    const q = query.trim().toLowerCase()
    const notes = links.notes.filter((n) => n.path !== links.current)
    const starts = notes.filter((n) => n.name.toLowerCase().startsWith(q))
    const has = notes.filter((n) => !starts.includes(n) && (n.name.toLowerCase().includes(q) || n.path.toLowerCase().includes(q)))
    const list: (MenuItem & { name: string; create?: boolean })[] = [...starts, ...has].slice(0, 8).map((n) => ({
      key: n.path,
      name: n.name,
      label: n.name,
      icon: FileTextIcon,
      hint: n.path.includes("/") ? n.path.replace(/\/[^/]*$/, "") : undefined,
    }))
    if (q && !notes.some((n) => n.name.toLowerCase() === q))
      list.push({ key: "+new", name: query.trim(), label: `New note “${query.trim()}”`, icon: FilePlusIcon, create: true })
    return list
  }, [query, links])

  return (
    <InlineMenu
      at={at}
      items={items}
      onPick={(o, at) => {
        const end = at.offset + (at.after === "]]" ? 2 : 0)
        editor.tf.select({ anchor: { path: at.path, offset: at.start }, focus: { path: at.path, offset: end } })
        editor.tf.insertText(`[[${o.name}]]`)
        editor.tf.focus()
        if (o.create) links?.create(o.name)
      }}
    />
  )
}
