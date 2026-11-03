import { useEffect, useRef, useState } from "react"
import {
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TelescopeIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type CslName, type NoteFile, type RefCandidate, type Reference, type Source } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"
import { ExportDialog, StylePicker, copyRich, matchesRef, refAuthors, refYear, savedStyle, saveStyle } from "./cite"

interface Props {
  projectId: string
  notes: NoteFile[]
  papers: Source[]
  chatOpen: boolean
  onToggleChat: () => void
}

export function ReferencesView({ projectId, notes, papers, chatOpen, onToggleChat }: Props) {
  const [refs, setRefs] = useState<Reference[] | null>(null)
  const [q, setQ] = useState("")
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Reference | null>(null)
  const [exporting, setExporting] = useState<"all" | "selected" | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [style, setStyle] = useState(savedStyle)

  const load = () => api.references(projectId).then(setRefs, (e) => toast.error(e.message))
  useEffect(() => {
    load()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Papers with a DOI are added in the background after upload; pick them up.
  useEffect(() => {
    const t = window.setTimeout(load, 2500)
    return () => window.clearTimeout(t)
  }, [papers.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = (refs ?? []).filter((r) => matchesRef(r, q))

  // Forget picks that were deleted or re-keyed.
  useEffect(() => {
    if (!refs) return
    setSelected((sel) => {
      const next = new Set([...sel].filter((id) => refs.some((r) => r.id === id)))
      return next.size === sel.size ? sel : next
    })
  }, [refs])

  useEffect(() => {
    if (!selected.size) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=dialog],[role=menu],[data-radix-popper-content-wrapper]"))
        setSelected(new Set())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selected.size])

  const toggle = (id: string, on: boolean) =>
    setSelected((sel) => {
      const next = new Set(sel)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })
  const shownPicked = shown.filter((r) => selected.has(r.id)).length
  const allState = shownPicked === 0 ? false : shownPicked === shown.length ? true : "indeterminate"
  const toggleAll = () =>
    setSelected((sel) => {
      const next = new Set(sel)
      for (const r of shown) {
        if (allState === true) next.delete(r.id)
        else next.add(r.id)
      }
      return next
    })
  // In list order, so styles that number by order of appearance (IEEE, Vancouver) follow the page.
  const pickedIds = (refs ?? []).filter((r) => selected.has(r.id)).map((r) => r.id)

  const copySelected = async (format: "bibliography" | "citation") => {
    try {
      const body = { style: style.id, format, ids: pickedIds }
      const [html, text] = await Promise.all([
        api.renderReferences(projectId, { ...body, output: "html" }),
        api.renderReferences(projectId, { ...body, output: "text" }),
      ])
      await copyRich(html.text, text.text.trim())
      const n = pickedIds.length
      toast.success(
        format === "citation"
          ? `Copied in-text citation: ${text.text.trim()}`
          : `Copied ${n} reference${n === 1 ? "" : "s"} in ${style.title}`,
      )
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const removeSelected = async () => {
    const gone = (refs ?? []).filter((r) => selected.has(r.id))
    try {
      for (const r of gone) await api.removeReference(projectId, r.id)
      setRefs((rs) => rs?.filter((x) => !selected.has(x.id)) ?? rs)
      setSelected(new Set())
      toast(`${gone.length} reference${gone.length === 1 ? "" : "s"} removed`, {
        action: {
          label: "Undo",
          onClick: async () => {
            await api.restoreReferences(projectId, gone)
            load()
          },
        },
      })
    } catch (err) {
      toast.error((err as Error).message)
      load()
    }
  }

  const remove = async (r: Reference) => {
    try {
      await api.removeReference(projectId, r.id)
      setRefs((rs) => rs?.filter((x) => x.id !== r.id) ?? rs)
      toast("Reference removed", {
        action: {
          label: "Undo",
          onClick: async () => {
            await api.restoreReferences(projectId, [r])
            load()
          },
        },
      })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const copyFormatted = async (r: Reference) => {
    try {
      const style = savedStyle()
      const [html, text] = await Promise.all([
        api.renderReferences(projectId, { style: style.id, format: "bibliography", output: "html", ids: [r.id] }),
        api.renderReferences(projectId, { style: style.id, format: "bibliography", output: "text", ids: [r.id] }),
      ])
      await copyRich(html.text, text.text.trim())
      toast.success(`Copied in ${style.title}`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const noteList = notes.map((n) => ({ path: n.path, name: n.name.replace(/\.md$/i, "") }))

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">References</span>
        {refs && <span className="text-xs text-muted-foreground">{refs.length}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => setExporting("all")} disabled={!refs?.length}>
            <DownloadIcon /> Export
          </Button>
          <Button size="sm" className="h-8" onClick={() => setAdding(true)}>
            <PlusIcon /> Add
          </Button>
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
            <TooltipContent>Chat (Ctrl/⌘ J)</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t">
        <div className="mx-auto max-w-3xl px-6 py-6">
          {refs && refs.length > 0 && (
            <div className="mb-4 flex items-center gap-3 pl-4">
              <Checkbox
                checked={allState}
                onCheckedChange={toggleAll}
                disabled={!shown.length}
                aria-label={allState === true ? "Unselect all" : "Select all"}
              />
              <div className="relative flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by author, title, year or key" className="pl-8" />
              </div>
            </div>
          )}
          {refs === null ? null : refs.length === 0 ? (
            <div className="mx-auto max-w-sm py-24 text-center text-sm text-muted-foreground">
              <p className="font-medium text-foreground">No references yet.</p>
              <p className="mt-1">
                Add one by DOI, BibTeX, RIS or title. PDFs you upload that have a DOI are added here on their own.
              </p>
              <Button variant="outline" className="mt-4" onClick={() => setAdding(true)}>
                <PlusIcon /> Add a reference
              </Button>
            </div>
          ) : (
            <div className={cn("divide-y rounded-lg border", selected.size > 0 && "mb-20")}>
              {shown.map((r) => {
                const paper = r.source ? papers.find((p) => p.id === r.source) : undefined
                return (
                  <div key={r.id} className={cn("group flex items-start gap-3 px-4 py-3", selected.has(r.id) && "bg-muted/50")}>
                    <Checkbox
                      className="mt-0.5"
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) => toggle(r.id, v === true)}
                      aria-label={`Select ${r.title || r.id}`}
                    />
                    <button className="min-w-0 flex-1 text-left" onClick={() => setEditing(r)}>
                      <p className="text-sm leading-snug font-medium">{r.title || "Untitled"}</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[refAuthors(r), refYear(r)].filter(Boolean).join(", ")}
                        {r["container-title"] && (
                          <>
                            {" · "}
                            <i>{r["container-title"]}</i>
                          </>
                        )}
                      </p>
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
                          onClick={async () => {
                            await navigator.clipboard.writeText(`[@${r.id}]`)
                            toast.success(`Copied [@${r.id}]`)
                          }}
                        >
                          @{r.id}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Copy citation for a note</TooltipContent>
                    </Tooltip>
                    {paper && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 shrink-0 text-muted-foreground"
                            aria-label="Open the PDF"
                            onClick={() => navigate({ name: "project", projectId, paper: paper.id })}
                          >
                            <FileTextIcon />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Open the PDF</TooltipContent>
                      </Tooltip>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label="More">
                          <MoreHorizontalIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing(r)}>
                          <PencilIcon /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => copyFormatted(r)}>
                          <CopyIcon /> Copy formatted
                        </DropdownMenuItem>
                        {r.DOI && (
                          <DropdownMenuItem onSelect={() => navigate({ name: "project", projectId, view: "discover", page: r.DOI })}>
                            <TelescopeIcon /> Find related papers
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => remove(r)}>
                          <Trash2Icon /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
              {shown.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</p>}
            </div>
          )}
        </div>
      </div>
      {selected.size > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center px-4">
          <div
            role="toolbar"
            aria-label="Selected references"
            className="pointer-events-auto flex items-center gap-1 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg"
          >
            <span className="px-2 text-sm whitespace-nowrap tabular-nums">{selected.size} selected</span>
            <Separator orientation="vertical" className="mx-1 !h-5" />
            <StylePicker
              value={style}
              onChange={(st) => {
                setStyle(st)
                saveStyle(st)
              }}
              className="h-8 w-64"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8">
                  <CopyIcon /> Copy <ChevronDownIcon className="-mr-1 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" side="top">
                <DropdownMenuItem onSelect={() => copySelected("bibliography")}>Reference list</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => copySelected("citation")}>In-text citation</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setExporting("selected")}>
              <DownloadIcon /> Export
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Delete selected" onClick={removeSelected}>
                  <Trash2Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground"
                  aria-label="Clear selection"
                  onClick={() => setSelected(new Set())}
                >
                  <XIcon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear selection (Esc)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}
      <AddDialog
        projectId={projectId}
        open={adding}
        onOpenChange={setAdding}
        onAdded={(added) => {
          if (added.length) load()
        }}
      />
      <EditDialog
        projectId={projectId}
        reference={editing}
        onClose={() => setEditing(null)}
        onSaved={(r, oldId) => setRefs((rs) => rs?.map((x) => (x.id === oldId ? r : x)) ?? rs)}
      />
      <ExportDialog
        projectId={projectId}
        open={exporting !== null}
        onOpenChange={(o) => {
          if (!o) {
            setExporting(null)
            setStyle(savedStyle())
          }
        }}
        notes={noteList}
        selected={exporting === "selected" ? pickedIds : undefined}
        total={refs?.length}
      />
    </div>
  )
}

function AddDialog({
  projectId,
  open,
  onOpenChange,
  onAdded,
}: {
  projectId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onAdded: (added: Reference[]) => void
}) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<RefCandidate[] | null>(null)
  const file = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setText("")
      setCandidates(null)
    }
  }, [open])

  const add = async (input: string, key = "main") => {
    if (!input.trim()) return
    setBusy(key)
    try {
      const res = await api.addReferences(projectId, input)
      if (res.candidates) {
        setCandidates(res.candidates)
        if (!res.candidates.length) toast("Nothing found for that title. Try the DOI, or paste a BibTeX entry.")
        return
      }
      onAdded(res.added)
      const parts = [
        res.added.length && `Added ${res.added.length} reference${res.added.length > 1 ? "s" : ""}`,
        res.existing.length && `${res.existing.length} already in your library`,
      ].filter(Boolean)
      toast.success(parts.join(", "))
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add references</DialogTitle>
          <DialogDescription>
            Paste a DOI or doi.org link, BibTeX or RIS (several at once is fine), or type a paper's title to search for it.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setCandidates(null)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(text)
          }}
          rows={5}
          placeholder={"10.1016/S0896-6273(02)00746-8\nor @article{…}\nor Practice with sleep makes perfect"}
          className="max-h-64 font-mono text-xs"
        />
        {candidates && candidates.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Pick the right one</Label>
            <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {candidates.map((c) => (
                <button
                  key={c.doi}
                  disabled={!!busy}
                  onClick={() => add(c.doi, c.doi)}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug">{c.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[c.authors, c.year, c.container].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {busy === c.doi ? <LoaderCircleIcon className="mt-0.5 size-4 animate-spin" /> : <PlusIcon className="mt-0.5 size-4 text-muted-foreground" />}
                </button>
              ))}
            </div>
          </div>
        )}
        <DialogFooter className="sm:justify-between">
          <input
            ref={file}
            type="file"
            accept=".bib,.ris,.json,.txt,.bibtex"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) add(await f.text())
            }}
          />
          <Button variant="ghost" className="text-muted-foreground" onClick={() => file.current?.click()} disabled={!!busy}>
            <UploadIcon /> Import a .bib or .ris file
          </Button>
          <Button onClick={() => add(text)} disabled={!text.trim() || !!busy}>
            {busy === "main" && <LoaderCircleIcon className="animate-spin" />}
            {/^\s*(@|TY {2}-|10\.|https?:\/\/(dx\.)?doi)/m.test(text) || !text.trim() ? "Add" : "Search"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const TYPES: { id: string; label: string }[] = [
  { id: "article-journal", label: "Journal article" },
  { id: "book", label: "Book" },
  { id: "chapter", label: "Book chapter" },
  { id: "paper-conference", label: "Conference paper" },
  { id: "article", label: "Preprint" },
  { id: "thesis", label: "Thesis" },
  { id: "report", label: "Report" },
  { id: "webpage", label: "Web page" },
  { id: "dataset", label: "Dataset" },
  { id: "article-magazine", label: "Magazine article" },
  { id: "article-newspaper", label: "Newspaper article" },
]

const namesToText = (ns?: CslName[]) => (ns ?? []).map((n) => (n.literal ? n.literal : [n.family, n.given].filter(Boolean).join(", "))).join("\n")
const textToNames = (t: string): CslName[] =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      if (l.includes(",")) {
        const [family, ...rest] = l.split(",")
        return { family: family.trim(), given: rest.join(",").trim() || undefined }
      }
      const parts = l.split(/\s+/)
      return parts.length > 1 ? { family: parts.at(-1), given: parts.slice(0, -1).join(" ") } : { literal: l }
    })

function EditDialog({
  projectId,
  reference,
  onClose,
  onSaved,
}: {
  projectId: string
  reference: Reference | null
  onClose: () => void
  onSaved: (r: Reference, oldId: string) => void
}) {
  const [form, setForm] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!reference) return
    setForm({
      id: reference.id,
      type: reference.type,
      title: reference.title ?? "",
      authors: namesToText(reference.author),
      year: refYear(reference),
      container: reference["container-title"] ?? "",
      volume: reference.volume ?? "",
      issue: reference.issue ?? "",
      page: reference.page ?? "",
      publisher: reference.publisher ?? "",
      DOI: reference.DOI ?? "",
      URL: reference.URL ?? "",
    })
  }, [reference])

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const save = async () => {
    if (!reference) return
    setSaving(true)
    try {
      const year = form.year.trim()
      const r = await api.updateReference(projectId, reference.id, {
        id: form.id.trim(),
        type: form.type,
        title: form.title.trim(),
        author: textToNames(form.authors),
        issued: /^\d{1,4}$/.test(year) ? { "date-parts": [[Number(year)]] } : year ? { literal: year } : (null as never),
        "container-title": form.container.trim(),
        volume: form.volume.trim(),
        issue: form.issue.trim(),
        page: form.page.trim(),
        publisher: form.publisher.trim(),
        DOI: form.DOI.trim(),
        URL: form.URL.trim(),
      })
      onSaved(r, reference.id)
      if (r.id !== reference.id) toast(`Key changed to @${r.id}. Notes that cite @${reference.id} need updating.`)
      onClose()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const field = (k: string, label: string, className?: string) => (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={`ref-${k}`}>{label}</Label>
      <Input id={`ref-${k}`} value={form[k] ?? ""} onChange={set(k)} />
    </div>
  )

  return (
    <Dialog open={!!reference} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit reference</DialogTitle>
          <DialogDescription>Fix anything the lookup got wrong. Citation styles format it for you.</DialogDescription>
        </DialogHeader>
        <form
          className="grid grid-cols-6 gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save()
          }}
        >
          <div className="col-span-6 grid gap-1.5">
            <Label htmlFor="ref-title">Title</Label>
            <Textarea id="ref-title" rows={2} value={form.title ?? ""} onChange={set("title")} className="min-h-0 resize-none" />
          </div>
          <div className="col-span-6 grid gap-1.5">
            <Label htmlFor="ref-authors">Authors</Label>
            <Textarea
              id="ref-authors"
              rows={3}
              value={form.authors ?? ""}
              onChange={set("authors")}
              placeholder={"One per line: Family, Given"}
              className="min-h-0 resize-none"
            />
          </div>
          <div className="col-span-3 grid gap-1.5">
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...TYPES, ...(TYPES.some((t) => t.id === form.type) || !form.type ? [] : [{ id: form.type, label: form.type }])].map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {field("year", "Year", "col-span-3")}
          {field("container", form.type === "chapter" ? "Book title" : "Journal / venue", "col-span-6")}
          {field("volume", "Volume", "col-span-2")}
          {field("issue", "Issue", "col-span-2")}
          {field("page", "Pages", "col-span-2")}
          {field("publisher", "Publisher", "col-span-6")}
          {field("DOI", "DOI", "col-span-3")}
          {field("URL", "URL", "col-span-3")}
          {field("id", "Citation key", "col-span-6")}
          <DialogFooter className="col-span-6">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <LoaderCircleIcon className="animate-spin" />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
