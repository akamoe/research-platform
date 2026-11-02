import { useEffect, useMemo, useRef, useState } from "react"
import { CheckIcon, ChevronsUpDownIcon, CopyIcon, DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api, type CitationStyle, type CiteFormat, type Reference } from "@/lib/api"
import { cn } from "@/lib/utils"

// ---------- small helpers shared by the references page and the note toolbar ----------

export const refYear = (r: Reference) => String(r.issued?.["date-parts"]?.[0]?.[0] ?? r.issued?.literal ?? "")

export function refAuthors(r: Reference, max = 3) {
  const names = (r.author ?? r.editor ?? []).map((a) => a.family ?? a.literal ?? a.given ?? "").filter(Boolean)
  if (!names.length) return ""
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return names.length > max ? `${names[0]} et al.` : `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`
}

export const refLine = (r: Reference) =>
  [refAuthors(r), refYear(r), r["container-title"]].filter(Boolean).join(" · ")

export function matchesRef(r: Reference, q: string) {
  const hay = `${r.id} ${r.title ?? ""} ${refAuthors(r, 99)} ${refYear(r)} ${r["container-title"] ?? ""} ${r.DOI ?? ""}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

const STYLE_KEY = "rp-cite-style"
export function savedStyle(): CitationStyle {
  try {
    const s = JSON.parse(localStorage.getItem(STYLE_KEY) ?? "")
    if (s?.id && s?.title) return s
  } catch {}
  return { id: "apa", title: "APA 7th edition (American Psychological Association)" }
}

/** Copy a formatted bibliography so it pastes with italics into Word or Google Docs, and as plain text elsewhere. */
export async function copyRich(html: string, text: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ])
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- style picker: the popular styles, or search all of them ----------

export function StylePicker({ value, onChange }: { value: CitationStyle; onChange: (s: CitationStyle) => void }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState("")
  const [results, setResults] = useState<CitationStyle[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!open) return
    setLoading(true)
    const t = window.setTimeout(
      () =>
        api
          .citationStyles(q)
          .then(setResults, () => setResults([]))
          .finally(() => setLoading(false)),
      q ? 250 : 0,
    )
    return () => window.clearTimeout(t)
  }, [q, open])
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="w-full min-w-0 justify-between font-normal">
          <span className="min-w-0 truncate">{value.title}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput value={q} onValueChange={setQ} placeholder="Search 10,000+ styles: journal, university, field…" />
          <CommandList>
            <CommandEmpty>{loading ? "Searching…" : "No style found. Try the journal's name."}</CommandEmpty>
            <CommandGroup heading={q ? undefined : "Popular"}>
              {results.map((s) => (
                <CommandItem
                  key={s.id}
                  value={s.id}
                  onSelect={() => {
                    onChange(s)
                    setOpen(false)
                  }}
                >
                  <span className="truncate">{s.title}</span>
                  {s.id === value.id && <CheckIcon className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ---------- export ----------

const FORMATS: { id: Exclude<CiteFormat, "citation">; label: string; ext: string; type: string }[] = [
  { id: "bibliography", label: "Bibliography", ext: "html", type: "text/html" },
  { id: "bibtex", label: "BibTeX", ext: "bib", type: "application/x-bibtex" },
  { id: "ris", label: "RIS", ext: "ris", type: "application/x-research-info-systems" },
  { id: "csljson", label: "CSL JSON", ext: "json", type: "application/json" },
]

/**
 * Export the library, or just what one note cites, as a formatted bibliography in any style
 * or as a BibTeX / RIS / CSL-JSON file.
 */
export function ExportDialog({
  projectId,
  open,
  onOpenChange,
  notes,
  initialNote,
  total,
}: {
  projectId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  notes: { path: string; name: string }[]
  initialNote?: string
  total?: number
}) {
  const [style, setStyle] = useState<CitationStyle>(savedStyle)
  const [scope, setScope] = useState(initialNote ?? "all")
  const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>("bibliography")
  const [out, setOut] = useState<{ text: string; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (open) setScope(initialNote ?? "all")
  }, [open, initialNote])

  const body = useMemo(
    () => ({ style: style.id, format, ...(scope === "all" ? {} : { notePath: scope }) }),
    [style.id, format, scope],
  )

  useEffect(() => {
    if (!open) return
    const n = ++seq.current
    setLoading(true)
    setError(null)
    api
      .renderReferences(projectId, { ...body, output: "html" })
      .then(
        (r) => n === seq.current && setOut({ text: r.text, count: r.ids?.length ?? total ?? 0 }),
        (e) => n === seq.current && (setError(e.message), setOut(null)),
      )
      .finally(() => n === seq.current && setLoading(false))
  }, [open, body, projectId, total])

  const pickStyle = (s: CitationStyle) => {
    setStyle(s)
    localStorage.setItem(STYLE_KEY, JSON.stringify(s))
  }

  const f = FORMATS.find((x) => x.id === format)!
  const empty = !loading && !error && out && !out.text.trim()
  const noteName = notes.find((n) => n.path === scope)?.name

  const copy = async () => {
    if (!out) return
    if (format === "bibliography") {
      const text = await api.renderReferences(projectId, { ...body, output: "text" })
      await copyRich(out.text, text.text)
    } else await navigator.clipboard.writeText(out.text)
    toast.success("Copied")
  }
  const save = () => {
    if (!out) return
    const base = scope === "all" ? "references" : `${noteName ?? "note"} references`
    const text =
      format === "bibliography"
        ? `<!doctype html><meta charset="utf-8"><title>${base}</title><style>body{font-family:serif;max-width:46rem;margin:3rem auto;line-height:1.6}.csl-entry{margin-bottom:.8em;padding-left:2em;text-indent:-2em}.csl-left-margin{float:left;min-width:2.5em;text-indent:0}.csl-right-inline{margin-left:2.5em;text-indent:0}</style>${out.text}`
        : out.text
    download(`${base}.${f.ext}`, text, f.type)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export references</DialogTitle>
          <DialogDescription>A bibliography in any citation style, or a file for Zotero, Mendeley, EndNote or LaTeX.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid min-w-0 gap-1.5">
            <Label>References</Label>
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All references{total !== undefined ? ` (${total})` : ""}</SelectItem>
                {notes.length > 0 && <SelectSeparator />}
                {notes.map((n) => (
                  <SelectItem key={n.path} value={n.path}>
                    Cited in “{n.name}”
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={cn("grid min-w-0 gap-1.5", format !== "bibliography" && "pointer-events-none opacity-50")}>
            <Label>Style</Label>
            <StylePicker value={style} onChange={pickStyle} />
          </div>
        </div>
        <Tabs value={format} onValueChange={(v) => setFormat(v as typeof format)}>
          <TabsList>
            {FORMATS.map((x) => (
              <TabsTrigger key={x.id} value={x.id}>
                {x.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative min-h-40 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4">
          {loading && <LoaderCircleIcon className="absolute top-3 right-3 size-4 animate-spin text-muted-foreground" />}
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : empty ? (
            <p className="text-sm text-muted-foreground">
              {scope === "all"
                ? "No references yet."
                : "This note doesn't cite anything yet. Use Cite in the note's toolbar to add citations like [@walker2002practice]."}
            </p>
          ) : format === "bibliography" ? (
            <div
              className="font-serif text-sm leading-relaxed [&_.csl-entry]:mb-2.5 [&_.csl-entry]:pl-8 [&_.csl-entry]:-indent-8 [&_.csl-left-margin]:float-left [&_.csl-left-margin]:min-w-8 [&_.csl-left-margin]:indent-0 [&_.csl-right-inline]:ml-8 [&_.csl-right-inline]:indent-0"
              // Citation-style output of the student's own library; the CSL processor escapes field text.
              dangerouslySetInnerHTML={{ __html: out?.text ?? "" }}
            />
          ) : (
            <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap">{out?.text}</pre>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="mr-auto text-xs text-muted-foreground">
            {out && !error && (scope === "all" ? `${total ?? out.count} references` : `${out.count} cited in this note`)}
          </span>
          <Button variant="outline" onClick={save} disabled={!out?.text || !!error}>
            <DownloadIcon /> Download .{f.ext}
          </Button>
          <Button onClick={copy} disabled={!out?.text || !!error}>
            <CopyIcon /> Copy
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
