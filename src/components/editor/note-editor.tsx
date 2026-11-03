import { useEffect, useRef, useState } from "react"
import { Plate, PlateContent, usePlateEditor } from "platejs/react"
import { MarkdownPlugin } from "@platejs/markdown"
import { KEYS, type TElement } from "platejs"
import { editorPlugins, unescapeCitations } from "./plugins"
import { EditorToolbar } from "./toolbar"
import { NoteLinkMenu, NoteLinksContext, type NoteLinks } from "./note-links"
import { CiteMenu, SlashMenu } from "./slash-menu"
import { onHighlightRecolored } from "@/lib/highlight-events"

/** Lets the paper view drop quotes and figures into the note. */
export interface NoteInserter {
  insertMarkdown: (markdown: string) => void
}

interface Props {
  initialMarkdown: string
  /** Called (debounced) with the note as markdown whenever the student edits. */
  onChange: (markdown: string) => void
  onReady?: (inserter: NoteInserter | null) => void
  /** Lets the toolbar's Cite button reach the project's references. */
  projectId?: string
  notePath?: string
  /** Lets `[[note]]` links find and open the project's notes. */
  links?: NoteLinks
}

export function NoteEditor({ initialMarkdown, onChange, onReady, projectId, notePath, links }: Props) {
  const editor = usePlateEditor({
    plugins: editorPlugins,
    value: (e) => {
      const nodes = e.getApi(MarkdownPlugin).markdown.deserialize(initialMarkdown)
      return nodes.length ? nodes : [{ type: "p", children: [{ text: "" }] }]
    },
  })
  const timer = useRef<number | undefined>(undefined)
  const pending = useRef(false)
  // autoFocus puts the cursor at the top; only insert there once the student placed it.
  const placed = useRef(false)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const flush = () => {
    window.clearTimeout(timer.current)
    if (!pending.current) return
    pending.current = false
    changeRef.current(unescapeCitations(editor.getApi(MarkdownPlugin).markdown.serialize()))
  }
  // Save straight away if the student switches notes mid-edit.
  useEffect(() => flush, [])

  useEffect(() => {
    onReady?.({
      insertMarkdown: (md) => {
        const nodes = editor.getApi(MarkdownPlugin).markdown.deserialize(md)
        if (!nodes.length) return
        // After the block the cursor was last in, or at the end of the note.
        const at =
          placed.current && editor.selection ? [editor.selection.anchor.path[0] + 1] : [editor.children.length]
        editor.tf.insertNodes(nodes, { at, select: true })
      },
    })
    return () => onReady?.(null)
  }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // A highlight changed colour in the PDF: change the dot on its links here too.
  useEffect(
    () =>
      onHighlightRecolored(({ url, dot }) => {
        const found = [...editor.api.nodes<TElement>({ at: [], match: (n) => (n as TElement).type === KEYS.link && (n as { url?: string }).url === url })]
        for (const [, path] of found.reverse()) {
          const text = editor.api.string(path)
          const next = text.replace(/^\S+/u, dot)
          if (next !== text) editor.tf.insertText(next, { at: editor.api.range(path) })
        }
      }),
    [editor],
  )

  return (
    <NoteLinksContext.Provider value={links ?? null}>
    <Plate
      editor={editor}
      onValueChange={() => {
        pending.current = true
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, 600)
      }}
    >
      <EditorToolbar
        projectId={projectId}
        notePath={notePath}
        className="sticky top-0 z-10 -mx-2 mb-4 border-b bg-background/95 px-1 py-1.5 backdrop-blur" />
      <PlateContent
        className="min-h-[60vh] pb-[30vh] font-serif text-[17px] leading-[1.75] outline-none [&_strong]:font-semibold"
        placeholder="Start writing. Markdown works: # heading, - list, > quote, **bold**, [[note]], / for blocks"
        spellCheck
        autoFocus
        onMouseDown={() => {
          placed.current = true
        }}
        onKeyDown={() => {
          placed.current = true
        }}
      />
      {links && <NoteLinkMenu />}
      <SlashMenu />
      {projectId && <CiteMenu projectId={projectId} />}
    </Plate>
    </NoteLinksContext.Provider>
  )
}

/** Plain markdown source view, for anything the rich editor doesn't cover. */
export function SourceEditor({ initialMarkdown, onChange, onReady }: Props) {
  const [value, setValue] = useState(initialMarkdown)
  const timer = useRef<number | undefined>(undefined)
  const latest = useRef<string | null>(null)
  const changeRef = useRef(onChange)
  changeRef.current = onChange
  const flush = () => {
    window.clearTimeout(timer.current)
    if (latest.current === null) return
    changeRef.current(latest.current)
    latest.current = null
  }
  useEffect(() => flush, [])
  useEffect(() => {
    onReady?.({
      insertMarkdown: (md) =>
        setValue((v) => {
          const next = `${v.replace(/\s*$/, "")}\n\n${md}\n`
          latest.current = next
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(flush, 600)
          return next
        }),
    })
    return () => onReady?.(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () =>
      onHighlightRecolored(({ url, dot }) =>
        setValue((v) => {
          const esc = url.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
          const next = v.replace(new RegExp(`\\[[^\\s\\[\\]]+( [^\\]\\n]*)\\]\\(${esc}\\)`, "gu"), (_m, rest: string) => `[${dot}${rest}](${url})`)
          if (next !== v) {
            latest.current = next
            window.clearTimeout(timer.current)
            timer.current = window.setTimeout(flush, 600)
          }
          return next
        }),
      ),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )
  return (
    <textarea
      value={value}
      onChange={(e) => {
        const v = e.target.value
        setValue(v)
        latest.current = v
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(flush, 600)
      }}
      spellCheck
      className="min-h-[70vh] w-full resize-none bg-transparent font-mono text-sm leading-relaxed outline-none"
    />
  )
}
