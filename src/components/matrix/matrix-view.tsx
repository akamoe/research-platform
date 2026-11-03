import { Fragment, useEffect, useRef, useState } from "react"
import {
  ClipboardCopyIcon,
  DownloadIcon,
  EyeOffIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Matrix, type MatrixCell, type MatrixColumn, type Reference, type Source } from "@/lib/api"
import { openSourceAt } from "@/lib/jump"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import { refYear } from "@/components/references/cite"

const MARKER = /\[h:([\w-]+):(\d+)\]|\[p:(\d+)\]/g

type Part = { text: string } | { page: number; highlight?: string }
function parts(text: string): Part[] {
  const out: Part[] = []
  let last = 0
  for (const m of text.matchAll(MARKER)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) })
    out.push(m[1] ? { page: Number(m[2]), highlight: m[1] } : { page: Number(m[3]) })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
const pageLabel = (page: number) => (page ? `p. ${page}` : "source")
/** Markers as readable "[p. 4]" for editing and export. */
const readable = (text: string) => text.replace(MARKER, (_, _h, hp, pp) => `[${pageLabel(Number(hp ?? pp))}]`)
/** Back from "[p. 4]" to markers, reusing the original highlight links in order. */
function unreadable(edited: string, original: string) {
  const pool = [...original.matchAll(MARKER)].map((m) => ({ marker: m[0], page: Number(m[2] ?? m[3]), used: false }))
  return edited.replace(/\[(?:p\. ?(\d+)|source)\]/g, (_, p) => {
    const page = p ? Number(p) : 0
    const hit = pool.find((x) => !x.used && x.page === page)
    if (hit) {
      hit.used = true
      return hit.marker
    }
    return `[p:${page}]`
  })
}

const newId = () => Math.random().toString(36).slice(2, 10)

function csvField(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

interface Props {
  projectId: string
  papers: Source[]
  chatOpen: boolean
  onToggleChat: () => void
}

export function MatrixView({ projectId, papers, chatOpen, onToggleChat }: Props) {
  const [m, setM] = useState<Matrix | null>(null)
  const [refs, setRefs] = useState<Reference[]>([])
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [run, setRun] = useState<{ done: number; total: number } | null>(null)
  const stop = useRef(false)
  const [editing, setEditing] = useState<{ sid: string; col: string } | null>(null)
  const [draft, setDraft] = useState("")
  const [colDialog, setColDialog] = useState<MatrixColumn | "new" | null>(null)
  const mRef = useRef<Matrix | null>(null)
  const saving = useRef(Promise.resolve())

  useEffect(() => {
    api.matrix(projectId).then((x) => {
      mRef.current = x
      setM(x)
    }, (e) => toast.error(e.message))
    api.references(projectId).then(setRefs, () => {})
  }, [projectId])

  const change = (fn: (x: Matrix) => Matrix) => {
    if (!mRef.current) return
    const next = fn(mRef.current)
    mRef.current = next
    setM(next)
    saving.current = saving.current.then(() =>
      api.saveMatrix(projectId, next).then(
        () => {},
        (e) => {
          toast.error(e.message)
        },
      ),
    )
  }
  const setCell = (sid: string, col: string, cell: MatrixCell | undefined) =>
    change((x) => {
      const row = { ...(x.cells[sid] ?? {}) }
      if (cell) row[col] = cell
      else delete row[col]
      return { ...x, cells: { ...x.cells, [sid]: row } }
    })

  const rows = papers.filter((p) => !m?.hidden.includes(p.id))
  const hidden = papers.length - rows.length
  const refFor = (sid: string) => refs.find((r) => r.source === sid)
  const isEmpty = (c?: MatrixCell) => !c || (!c.text && !c.none)

  /** Fill one paper's empty cells (or the given columns). Returns false when it's pointless to go on. */
  const fillRow = async (sid: string, columns?: string[], overwrite = false) => {
    const key = columns?.length === 1 ? `${sid}/${columns[0]}` : sid
    setBusy((b) => new Set(b).add(key))
    try {
      const { row } = await api.fillMatrix(projectId, sid, columns, overwrite)
      // Keep what the student typed meanwhile; take the AI's cells.
      const cur = mRef.current!
      const merged = { ...(cur.cells[sid] ?? {}) }
      for (const [k, v] of Object.entries(row)) if (merged[k]?.by !== "student") merged[k] = v
      mRef.current = { ...cur, cells: { ...cur.cells, [sid]: merged } }
      setM(mRef.current)
      return true
    } catch (err) {
      const msg = (err as Error).message
      toast.error(msg)
      return !/model|key|provider/i.test(msg)
    } finally {
      setBusy((b) => {
        const n = new Set(b)
        n.delete(key)
        return n
      })
    }
  }

  const fillAll = async (columns?: string[]) => {
    if (!m) return
    const cols = columns ?? m.columns.map((c) => c.id)
    const todo = rows.filter((p) => p.hasText && cols.some((c) => isEmpty(m.cells[p.id]?.[c])))
    if (!todo.length) return toast("Every cell is filled. Clear a cell or use “Fill again” on one to redo it.")
    stop.current = false
    setRun({ done: 0, total: todo.length })
    let i = 0
    const worker = async () => {
      while (i < todo.length && !stop.current) {
        const p = todo[i++]
        const ok = await fillRow(p.id, columns)
        if (!ok) stop.current = true
        setRun((r) => r && { ...r, done: r.done + 1 })
      }
    }
    await Promise.all([worker(), worker()])
    setRun(null)
  }

  const asRows = () =>
    rows.map((p) => {
      const r = refFor(p.id)
      return {
        title: p.title,
        cite: r ? `[@${r.id}]` : "",
        year: r ? refYear(r) : "",
        cells: m!.columns.map((c) =>
          readable(m!.cells[p.id]?.[c.id]?.text ?? "")
            .replace(/\[(p\. \d+|source)\]/g, "($1)")
            .replace(/\)\(/g, "; "),
        ),
      }
    })
  const copyMarkdown = async () => {
    const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ")
    const head = `| Source | ${m!.columns.map((c) => esc(c.name)).join(" | ")} |`
    const sep = `|${" --- |".repeat(m!.columns.length + 1)}`
    const body = asRows().map((r) => `| ${esc(`${r.title}${r.cite ? ` ${r.cite}` : ""}`)} | ${r.cells.map(esc).join(" | ")} |`)
    await navigator.clipboard.writeText([head, sep, ...body].join("\n"))
    toast.success("Copied as a Markdown table", { description: "Paste it into a note." })
  }
  const downloadCsv = () => {
    const lines = [["Source", "Year", "Cite key", ...m!.columns.map((c) => c.name)], ...asRows().map((r) => [r.title, r.year, r.cite.replace(/^\[@|\]$/g, ""), ...r.cells])]
    const blob = new Blob(["﻿" + lines.map((l) => l.map(csvField).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = "literature-matrix.csv"
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const startEdit = (sid: string, col: string) => {
    setDraft(readable(m?.cells[sid]?.[col]?.text ?? ""))
    setEditing({ sid, col })
  }
  const saveEdit = () => {
    if (!editing) return
    const { sid, col } = editing
    const old = m?.cells[sid]?.[col]
    const text = unreadable(draft.trim(), old?.text ?? "")
    if (text !== (old?.text ?? "")) setCell(sid, col, text ? { text, by: "student", at: new Date().toISOString() } : undefined)
    setEditing(null)
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">Literature matrix</span>
        <div className="ml-auto flex items-center gap-1">
          {run ? (
            <Button variant="outline" size="sm" className="h-8" onClick={() => (stop.current = true)}>
              <LoaderCircleIcon className="animate-spin" /> Filling {Math.min(run.done + 1, run.total)} of {run.total} · Stop
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="h-8" disabled={!rows.length || !m} onClick={() => fillAll()}>
              <SparklesIcon /> Fill empty cells
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" disabled={!rows.length}>
                <DownloadIcon /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={copyMarkdown}>
                <ClipboardCopyIcon /> Copy as Markdown table
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadCsv}>
                <DownloadIcon /> Download CSV (Excel)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-8 text-muted-foreground", chatOpen && "bg-muted text-foreground")}
                onClick={onToggleChat}
              >
                <MessageSquareIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {m && !papers.length ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Add sources to compare them here, one row per paper.
        </div>
      ) : m ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20 bg-background">
              <tr>
                <th className="sticky left-0 z-30 w-64 min-w-64 border-b bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Source
                </th>
                {m.columns.map((c) => (
                  <th key={c.id} className="group w-64 min-w-64 border-b px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span className="truncate" title={c.hint}>
                        {c.name}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ml-auto size-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                            aria-label={`Column ${c.name}`}
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => fillAll([c.id])} disabled={!!run}>
                            <SparklesIcon /> Fill this column
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setColDialog(c)}>
                            <PencilIcon /> Edit column
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={() => {
                              const before = mRef.current
                              change((x) => ({ ...x, columns: x.columns.filter((y) => y.id !== c.id) }))
                              toast(`Removed the “${c.name}” column`, { action: { label: "Undo", onClick: () => before && change(() => before) } })
                            }}
                          >
                            <Trash2Icon /> Remove column
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </th>
                ))}
                <th className="w-12 border-b px-2 py-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" onClick={() => setColDialog("new")} aria-label="Add column">
                        <PlusIcon />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Add column</TooltipContent>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const r = refFor(p.id)
                const rowBusy = busy.has(p.id)
                return (
                  <tr key={p.id} className="group/row" data-testid="matrix-row">
                    <th className="sticky left-0 z-10 border-b bg-background px-3 py-3 text-left align-top font-normal">
                      <div className="flex items-start gap-1">
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="line-clamp-2 text-left font-medium hover:underline"
                            onClick={() => navigate({ name: "project", projectId, paper: p.id })}
                          >
                            {p.title}
                          </button>
                          {r && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {[r.author?.[0]?.family, refYear(r)].filter(Boolean).join(" ")} · @{r.id}
                            </p>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6 shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                              aria-label={`Row ${p.title}`}
                            >
                              {rowBusy ? <LoaderCircleIcon className="animate-spin" /> : <MoreHorizontalIcon />}
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuItem disabled={rowBusy || !p.hasText} onSelect={() => fillRow(p.id)}>
                              <SparklesIcon /> Fill empty cells in this row
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => change((x) => ({ ...x, hidden: [...x.hidden, p.id] }))}>
                              <EyeOffIcon /> Hide from matrix
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </th>
                    {m.columns.map((c) => {
                      const cell = m.cells[p.id]?.[c.id]
                      const cellBusy = rowBusy || busy.has(`${p.id}/${c.id}`)
                      const open = editing?.sid === p.id && editing.col === c.id
                      return (
                        <td key={c.id} className="group/cell relative border-b px-3 py-3 align-top" data-testid="matrix-cell">
                          <Popover open={open} onOpenChange={(o) => (o ? startEdit(p.id, c.id) : saveEdit())}>
                            <PopoverAnchor asChild>
                              <div
                                role="button"
                                tabIndex={0}
                                className="min-h-10 cursor-text rounded-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                                onClick={(e) => {
                                  if ((e.target as HTMLElement).closest("[data-cite]")) return
                                  startEdit(p.id, c.id)
                                }}
                                onKeyDown={(e) => e.key === "Enter" && startEdit(p.id, c.id)}
                              >
                                {cellBusy && isEmpty(cell) ? (
                                  <span className="text-muted-foreground">Reading…</span>
                                ) : cell?.none ? (
                                  <span className="text-muted-foreground/70" title="The AI found nothing on this in your highlights or the source">Not found</span>
                                ) : cell?.text ? (
                                  <CellText text={cell.text} onCite={(page) => openSourceAt(projectId, { sourceId: p.id, page: page || 1 })} />
                                ) : null}
                              </div>
                            </PopoverAnchor>
                            <PopoverContent align="start" className="w-80 p-2" onOpenAutoFocus={(e) => e.preventDefault()}>
                              <Textarea
                                autoFocus
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder={c.hint ? `${c.hint}…` : "Your note…"}
                                className="min-h-28 text-sm"
                                aria-label={`${c.name} for ${p.title}`}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit()
                                  if (e.key === "Escape") {
                                    e.preventDefault()
                                    setEditing(null)
                                  }
                                }}
                              />
                              <div className="mt-2 flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-muted-foreground"
                                  disabled={cellBusy || !p.hasText}
                                  onClick={() => {
                                    setEditing(null)
                                    fillRow(p.id, [c.id], true)
                                  }}
                                >
                                  <SparklesIcon /> {cell?.text || cell?.none ? "Fill again" : "Fill with AI"}
                                </Button>
                                {cell && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-muted-foreground"
                                    onClick={() => {
                                      setCell(p.id, c.id, undefined)
                                      setEditing(null)
                                    }}
                                  >
                                    <XIcon /> Clear
                                  </Button>
                                )}
                                <Button size="sm" className="ml-auto h-7" onClick={saveEdit}>
                                  Save
                                </Button>
                              </div>
                              {cell?.by === "ai" && cell.text && (
                                <p className="mt-2 text-xs text-muted-foreground">Filled by AI from your highlights. Check it against the page before you rely on it.</p>
                              )}
                            </PopoverContent>
                          </Popover>
                        </td>
                      )
                    })}
                    <td className="border-b" />
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center gap-3 px-3 py-3 text-xs text-muted-foreground">
            <span>The AI takes notes from your highlights first, and from the paper's text when you've highlighted little. Click a cell to edit it; the AI never changes what you wrote.</span>
            {hidden > 0 && (
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => change((x) => ({ ...x, hidden: [] }))}>
                Show {hidden} hidden
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <ColumnDialog
        column={colDialog}
        onClose={() => setColDialog(null)}
        onSave={(name, hint) => {
          if (colDialog === "new") change((x) => ({ ...x, columns: [...x.columns, { id: newId(), name, hint: hint || undefined }] }))
          else if (colDialog) {
            const id = colDialog.id
            change((x) => ({ ...x, columns: x.columns.map((c) => (c.id === id ? { ...c, name, hint: hint || undefined } : c)) }))
          }
          setColDialog(null)
        }}
      />
    </div>
  )
}

function CellText({ text, onCite }: { text: string; onCite: (page: number) => void }) {
  return (
    <span className="whitespace-pre-wrap">
      {parts(text).map((part, i) =>
        "text" in part ? (
          <Fragment key={i}>{part.text}</Fragment>
        ) : (
          <button
            key={i}
            type="button"
            data-cite
            onClick={() => onCite(part.page)}
            title={part.highlight ? "Your highlight. Open the page" : "Open the page"}
            className={cn(
              "mx-0.5 inline rounded px-1 py-px align-baseline text-[11px] font-medium text-muted-foreground hover:text-foreground",
              part.highlight ? "bg-yellow-200/60 dark:bg-yellow-500/20" : "bg-muted",
            )}
          >
            {pageLabel(part.page)}
          </button>
        ),
      )}
    </span>
  )
}

function ColumnDialog({
  column,
  onClose,
  onSave,
}: {
  column: MatrixColumn | "new" | null
  onClose: () => void
  onSave: (name: string, hint: string) => void
}) {
  const [name, setName] = useState("")
  const [hint, setHint] = useState("")
  useEffect(() => {
    if (column && column !== "new") {
      setName(column.name)
      setHint(column.hint ?? "")
    } else {
      setName("")
      setHint("")
    }
  }, [column])
  return (
    <Dialog open={!!column} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim()) onSave(name.trim(), hint.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>{column === "new" ? "Add column" : "Edit column"}</DialogTitle>
            <DialogDescription>A question to ask of every source, like “Theory used” or “Country”.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="col-name">Name</Label>
              <Input id="col-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="col-hint">What to look for (optional)</Label>
              <Input id="col-hint" value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Helps the AI find the right part" maxLength={300} />
            </div>
          </div>
          <DialogFooter className="mt-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {column === "new" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
