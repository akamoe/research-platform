import { useEffect, useMemo, useState } from "react"
import { KEYS } from "platejs"
import { useEditorRef, type PlateEditor } from "platejs/react"
import { toggleList } from "@platejs/list"
import { insertTable } from "@platejs/table"
import {
  CodeSquareIcon,
  FileTextIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  MinusIcon,
  PilcrowIcon,
  QuoteIcon,
  TableIcon,
  TextQuoteIcon,
  InfoIcon,
} from "lucide-react"
import { api, type Reference } from "@/lib/api"
import { InlineMenu, useTrigger, type MenuItem, type TriggerAt } from "./inline-menu"

type Command = MenuItem & { keywords: string; run: (editor: PlateEditor) => void }

/** Turn the current block into `type`, taking it out of a list first. */
const setBlock = (type: string) => (editor: PlateEditor) => {
  const top = editor.selection?.anchor.path[0]
  const block = editor.api.block({ highest: true })?.[0] as { type?: string; listStyleType?: string } | undefined
  if (block?.listStyleType) toggleList(editor, { listStyleType: block.listStyleType })
  if ((block?.type ?? KEYS.p) !== type) editor.tf.toggleBlock(type)
  // Wrapping an empty line (quote) can leave the cursor in the line above; keep it here.
  if (top !== undefined && editor.children[top]) editor.tf.select(editor.api.end([top])!)
}
const setList = (type: string) => (editor: PlateEditor) => {
  const block = editor.api.block({ highest: true })?.[0] as { listStyleType?: string } | undefined
  if (block?.listStyleType !== type) toggleList(editor, { listStyleType: type })
}

export const COMMANDS: Command[] = [
  { key: "text", label: "Text", icon: PilcrowIcon, keywords: "paragraph plain", run: setBlock(KEYS.p) },
  { key: "h1", label: "Heading 1", icon: Heading1Icon, hint: "#", keywords: "title h1", run: setBlock(KEYS.h1) },
  { key: "h2", label: "Heading 2", icon: Heading2Icon, hint: "##", keywords: "subtitle h2", run: setBlock(KEYS.h2) },
  { key: "h3", label: "Heading 3", icon: Heading3Icon, hint: "###", keywords: "h3", run: setBlock(KEYS.h3) },
  { key: "ul", label: "Bulleted list", icon: ListIcon, hint: "-", keywords: "bullet unordered", run: setList(KEYS.ul) },
  { key: "ol", label: "Numbered list", icon: ListOrderedIcon, hint: "1.", keywords: "ordered number", run: setList(KEYS.ol) },
  { key: "todo", label: "Checklist", icon: ListChecksIcon, hint: "[]", keywords: "todo task checkbox", run: setList(KEYS.listTodo) },
  { key: "quote", label: "Quote", icon: TextQuoteIcon, hint: ">", keywords: "blockquote", run: setBlock(KEYS.blockquote) },
  {
    key: "callout",
    label: "Callout",
    icon: InfoIcon,
    hint: "> [!note]",
    keywords: "note tip warning admonition box",
    run: (editor) => {
      const top = editor.selection?.anchor.path[0]
      if (top === undefined) return
      // Keep the line's words; start the callout with them.
      const words = editor.api.string([top])
      editor.tf.withoutNormalizing(() => {
        editor.tf.removeNodes({ at: [top] })
        editor.tf.insertNodes(
          { type: KEYS.blockquote, children: [{ type: KEYS.p, children: [{ text: `[!note] ${words}` }] }] },
          { at: [top] },
        )
      })
      editor.tf.select(editor.api.end([top])!)
    },
  },
  {
    key: "table",
    label: "Table",
    icon: TableIcon,
    hint: "| |",
    keywords: "grid columns rows",
    run: (editor) => {
      const top = editor.selection?.anchor.path[0]
      const empty = top !== undefined && editor.api.string([top]) === "" && !(editor.children[top] as { listStyleType?: string }).listStyleType
      insertTable(editor, { rowCount: 3, colCount: 3, header: true }, { select: true })
      if (empty) editor.tf.removeNodes({ at: [top] })
    },
  },
  { key: "code", label: "Code block", icon: CodeSquareIcon, hint: "```", keywords: "pre snippet", run: setBlock(KEYS.codeBlock) },
  {
    key: "hr",
    label: "Divider",
    icon: MinusIcon,
    hint: "---",
    keywords: "hr rule line separator",
    run: (editor) => {
      const top = editor.selection?.anchor.path[0] ?? editor.children.length - 1
      const empty = editor.api.string([top]) === ""
      editor.tf.withoutNormalizing(() => {
        editor.tf.insertNodes({ type: KEYS.hr, children: [{ text: "" }] }, { at: [top] })
        if (!empty) editor.tf.insertNodes({ type: KEYS.p, children: [{ text: "" }] }, { at: [top + 2], select: true })
      })
      if (empty) editor.tf.select(editor.api.start([top + 1])!)
    },
  },
  { key: "cite", label: "Citation", icon: QuoteIcon, hint: "[@", keywords: "cite reference source", run: (e) => e.tf.insertText("[@") },
  { key: "link", label: "Link to note", icon: FileTextIcon, hint: "[[", keywords: "page wiki note", run: (e) => e.tf.insertText("[[") },
]

// A slash at the start of a line or after a space, so "and/or" and URLs never open it.
const SLASH = /(?<=^|\s)\/([a-z0-9]*)$/i

/** Type `/` to turn the line into a heading, list, quote… or start a citation or note link. */
export function SlashMenu({ extra = [] }: { extra?: Command[] }) {
  const editor = useEditorRef()
  const at = useTrigger(SLASH)
  const query = at?.query.toLowerCase()
  const items = useMemo(() => {
    if (query === undefined) return []
    const all = [...COMMANDS, ...extra]
    if (!query) return all
    // A label that starts with the query first, then a keyword that does, then any match.
    const rank = (c: Command) => {
      const label = c.label.toLowerCase()
      const words = c.keywords.split(" ")
      if (label.startsWith(query) || label.split(" ").some((w) => w.startsWith(query))) return 0
      if (words.some((w) => w.startsWith(query))) return 1
      if (`${label} ${c.keywords}`.includes(query)) return 2
      return -1
    }
    return all
      .map((c) => ({ c, r: rank(c) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.c)
  }, [query, extra])
  return (
    <InlineMenu
      at={at}
      items={items}
      onPick={(c, at: TriggerAt) => {
        editor.tf.delete({ at: { anchor: { path: at.path, offset: at.start }, focus: { path: at.path, offset: at.offset } } })
        c.run(editor)
      }}
    />
  )
}

const CITE = /\[@([\w:.-]*)$/

/** Type `[@` to pick a reference from the project's library; inserts `[@key]`. */
export function CiteMenu({ projectId }: { projectId: string }) {
  const editor = useEditorRef()
  const at = useTrigger(CITE)
  const [refs, setRefs] = useState<Reference[] | null>(null)
  const wanted = !!at
  useEffect(() => {
    if (wanted && refs === null) api.references(projectId).then(setRefs, () => setRefs([]))
  }, [wanted, refs, projectId])
  const query = at?.query.toLowerCase() ?? ""
  const items = useMemo(() => {
    const list = (refs ?? []).map((r) => {
      const first = r.author?.[0]
      const who = first ? (first.family ?? first.literal ?? "") : ""
      const year = r.issued?.["date-parts"]?.[0]?.[0]
      return { key: r.id, label: String(r.title ?? r.id), hint: [who, year].filter(Boolean).join(" "), haystack: `${r.id} ${r.title ?? ""} ${who} ${year ?? ""}`.toLowerCase() }
    })
    return (query ? list.filter((r) => r.haystack.includes(query)) : list).slice(0, 30)
  }, [refs, query])
  return (
    <InlineMenu
      at={at}
      items={items}
      empty={refs === null ? "Loading references…" : refs.length ? "No matching reference" : "No references yet. Add some under References."}
      onPick={(r, at) => {
        const end = at.offset + (at.after.startsWith("]") ? 1 : 0)
        editor.tf.select({ anchor: { path: at.path, offset: at.start }, focus: { path: at.path, offset: end } })
        editor.tf.insertText(`[@${r.key}]`)
      }}
    />
  )
}
