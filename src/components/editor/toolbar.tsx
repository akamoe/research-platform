import { useState, type ReactNode } from "react"
import { KEYS } from "platejs"
import { useEditorRef, useEditorSelector } from "platejs/react"
import { toggleList } from "@platejs/list"
import { upsertLink } from "@platejs/link"
import {
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  CodeIcon,
  HighlighterIcon,
  ItalicIcon,
  LinkIcon,
  ListChecksIcon,
  ListIcon,
  ListOrderedIcon,
  Redo2Icon,
  StrikethroughIcon,
  Undo2Icon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Toggle } from "@/components/ui/toggle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+"

const BLOCKS = [
  { type: KEYS.p, label: "Text" },
  { type: KEYS.h1, label: "Heading 1" },
  { type: KEYS.h2, label: "Heading 2" },
  { type: KEYS.h3, label: "Heading 3" },
  { type: KEYS.blockquote, label: "Quote" },
  { type: KEYS.codeBlock, label: "Code block" },
]

const LISTS = [
  { type: KEYS.ul, label: "Bulleted list", icon: ListIcon },
  { type: KEYS.ol, label: "Numbered list", icon: ListOrderedIcon },
  { type: KEYS.listTodo, label: "Checklist", icon: ListChecksIcon },
]

const MARKS = [
  { type: KEYS.bold, label: "Bold", keys: `${mod}B`, icon: BoldIcon },
  { type: KEYS.italic, label: "Italic", keys: `${mod}I`, icon: ItalicIcon },
  { type: KEYS.strikethrough, label: "Strikethrough", keys: `${mod}⇧X`, icon: StrikethroughIcon },
  { type: KEYS.code, label: "Inline code", keys: `${mod}E`, icon: CodeIcon },
  { type: KEYS.highlight, label: "Highlight", keys: `${mod}⇧H`, icon: HighlighterIcon },
]

function Tip({ label, keys, children }: { label: string; keys?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && <span className="ml-1.5 opacity-60">{keys}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Keeps the cursor in the note when a toolbar button is clicked. */
const keepSelection = (e: React.MouseEvent) => e.preventDefault()

function MarkButton({ type, label, keys, icon: Icon }: (typeof MARKS)[number]) {
  const editor = useEditorRef()
  const active = useEditorSelector((e) => !!e.selection && e.api.hasMark(type), [type])
  return (
    <Tip label={label} keys={keys}>
      <Toggle
        size="sm"
        pressed={active}
        aria-label={label}
        onMouseDown={keepSelection}
        onPressedChange={() => {
          editor.tf.toggleMark(type)
          editor.tf.focus()
        }}
      >
        <Icon />
      </Toggle>
    </Tip>
  )
}

/** The kind of the block the cursor is in: a block type, or `list:<style>` for list items. */
function useBlockKind() {
  return useEditorSelector((e) => {
    const entry = e.api.block({ highest: true })
    const node = entry?.[0] as { type?: string; listStyleType?: string } | undefined
    if (!node) return KEYS.p
    if (node.listStyleType) return `list:${node.listStyleType}`
    return node.type ?? KEYS.p
  }, [])
}

function BlockMenu({ kind }: { kind: string }) {
  const editor = useEditorRef()
  const current = BLOCKS.find((b) => b.type === kind)?.label ?? (kind.startsWith("list:") ? "List" : "Text")
  return (
    <DropdownMenu>
      <Tip label="Turn into">
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="h-8 w-[7.5rem] justify-between px-2 font-normal" onMouseDown={keepSelection}>
            {current}
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="start" className="min-w-40" onCloseAutoFocus={(e) => e.preventDefault()}>
        {BLOCKS.map((b) => (
          <DropdownMenuItem
            key={b.type}
            onSelect={() => {
              editor.tf.focus()
              if (kind.startsWith("list:")) toggleList(editor, { listStyleType: kind.slice(5) })
              editor.tf.toggleBlock(b.type)
            }}
          >
            {b.label}
            {b.type === kind && <CheckIcon className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LinkButton() {
  const editor = useEditorRef()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const active = useEditorSelector((e) => !!e.selection && e.api.some({ match: { type: KEYS.link } }), [])
  const apply = () => {
    const href = url.trim()
    setOpen(false)
    if (!href) return
    const full = /^[a-z][\w+.-]*:|^#|^\//i.test(href) ? href : `https://${href}`
    editor.tf.focus()
    upsertLink(editor, { url: full, ...(editor.api.isCollapsed() ? { text: href } : {}) })
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) {
          const link = editor.api.above({ match: { type: KEYS.link } })?.[0] as { url?: string } | undefined
          setUrl(link?.url ?? "")
        }
      }}
    >
      <Tip label="Link">
        <PopoverTrigger asChild>
          <Toggle size="sm" pressed={active} aria-label="Link" onMouseDown={keepSelection}>
            <LinkIcon />
          </Toggle>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="start" className="w-72 p-2" onCloseAutoFocus={(e) => e.preventDefault()}>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault()
            apply()
          }}
        >
          <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link" className="h-8" />
          <Button type="submit" size="sm" className="h-8">
            Add
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

/** A slim formatting bar above the note. Markdown shortcuts keep working too. */
export function EditorToolbar({ className }: { className?: string }) {
  const editor = useEditorRef()
  const kind = useBlockKind()
  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className={cn("flex items-center gap-0.5 overflow-x-auto [&>*]:shrink-0", className)}
    >
      <BlockMenu kind={kind} />
      <Separator orientation="vertical" className="mx-1 !h-5" />
      {MARKS.map((m) => (
        <MarkButton key={m.type} {...m} />
      ))}
      <LinkButton />
      <Separator orientation="vertical" className="mx-1 !h-5" />
      {LISTS.map(({ type, label, icon: Icon }) => (
        <Tip key={type} label={label}>
          <Toggle
            size="sm"
            pressed={kind === `list:${type}`}
            aria-label={label}
            onMouseDown={keepSelection}
            onPressedChange={() => {
              toggleList(editor, { listStyleType: type })
              editor.tf.focus()
            }}
          >
            <Icon />
          </Toggle>
        </Tip>
      ))}
      <div className="ml-auto flex items-center gap-0.5 pl-2">
        <Tip label="Undo" keys={`${mod}Z`}>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Undo" onMouseDown={keepSelection} onClick={() => editor.undo()}>
            <Undo2Icon />
          </Button>
        </Tip>
        <Tip label="Redo" keys={`${mod}⇧Z`}>
          <Button variant="ghost" size="icon" className="size-8" aria-label="Redo" onMouseDown={keepSelection} onClick={() => editor.redo()}>
            <Redo2Icon />
          </Button>
        </Tip>
      </div>
    </div>
  )
}
