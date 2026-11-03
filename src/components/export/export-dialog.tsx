import { useEffect, useState } from "react"
import { DownloadIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { StylePicker, saveStyle, savedStyle } from "@/components/references/cite"
import { api, type ExportFormat, type ExportStatus } from "@/lib/api"

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "docx", label: "Word" },
  { id: "pdf", label: "PDF" },
  { id: "odt", label: "OpenDocument" },
  { id: "html", label: "Web page" },
  { id: "latex", label: "LaTeX" },
]
const FORMAT_KEY = "rp-export-format"

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`

interface Props {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Notes to export, in order. */
  notes: string[]
  name: string
  /** Exporting a whole thesis: offer a title page and contents. */
  thesis?: { title: string }
  /** Shown under the title, e.g. chapters that were left out. */
  note?: string
  /** Wait for unsaved edits first. */
  beforeExport?: () => Promise<unknown>
}

export function ExportDialog({ projectId, open, onOpenChange, notes, name, thesis, note, beforeExport }: Props) {
  const [status, setStatus] = useState<ExportStatus | null>(null)
  const [format, setFormat] = useState<ExportFormat>(() => (localStorage.getItem(FORMAT_KEY) as ExportFormat) || "docx")
  const [style, setStyle] = useState(savedStyle)
  const [title, setTitle] = useState(thesis?.title ?? "")
  const [author, setAuthor] = useState(() => localStorage.getItem("rp-export-author") ?? "")
  const [toc, setToc] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    api.exportStatus().then(setStatus, (e) => toast.error(e.message))
    setTitle(thesis?.title ?? "")
  }, [open, thesis?.title])

  // Follow the pandoc download.
  useEffect(() => {
    if (!status?.install?.running) return
    const t = window.setInterval(() => api.exportStatus().then(setStatus, () => {}), 800)
    return () => window.clearInterval(t)
  }, [status?.install?.running])

  const run = async () => {
    setBusy(true)
    try {
      localStorage.setItem(FORMAT_KEY, format)
      if (author) localStorage.setItem("rp-export-author", author)
      saveStyle(style)
      await beforeExport?.()
      const res = await api.exportNotes(projectId, {
        notes,
        format,
        style: style.id,
        name,
        ...(thesis ? { title: title.trim() || undefined, author: author.trim() || undefined, toc } : {}),
      })
      const a = document.createElement("a")
      a.href = api.exportUrl(projectId, res.file)
      a.download = res.file
      a.click()
      onOpenChange(false)
      if (res.missingCitations.length)
        toast.warning(`${res.file} is ready, but some citations aren't in your References`, {
          description: res.missingCitations.map((k) => `@${k}`).join(", "),
        })
      else toast.success(`${res.file} is ready`, { description: res.style ? `Cited in ${style.title}` : "Cited in Chicago style (the chosen style couldn't be downloaded)" })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const installing = status?.install?.running
  const needsPandoc = status && !status.pandoc

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{thesis ? "Export thesis" : "Export note"}</DialogTitle>
          <DialogDescription>
            {note ?? "Your [@key] citations become real citations, with a reference list at the end."}
          </DialogDescription>
        </DialogHeader>

        {needsPandoc ? (
          <div className="space-y-3 rounded-md border p-3 text-sm">
            <p>
              Exporting uses <span className="font-medium">pandoc</span>, a free document converter. Folio can download it for you (about 35 MB, once).
            </p>
            {status.install?.error && <p className="text-destructive">{status.install.error}</p>}
            {installing ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <LoaderCircleIcon className="size-4 animate-spin" />
                Downloading… {status.install!.total ? `${mb(status.install!.done)} of ${mb(status.install!.total)}` : ""}
              </p>
            ) : status.installable ? (
              <Button size="sm" onClick={() => api.installPandoc().then(setStatus, (e) => toast.error(e.message))}>
                <DownloadIcon /> Download pandoc
              </Button>
            ) : (
              <p className="text-muted-foreground">Install it from pandoc.org, then reopen this window.</p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Format</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={format}
                onValueChange={(v) => v && setFormat(v as ExportFormat)}
                className="flex-wrap"
              >
                {FORMATS.map((f) => (
                  <ToggleGroupItem key={f.id} value={f.id} className="px-3">
                    {f.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {format === "pdf" && status && !status.pdf && (
                <p className="text-xs text-destructive">PDF uses LaTeX. Open the LaTeX tab once to set it up, or export to Word.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Citation style</Label>
              <StylePicker value={style} onChange={setStyle} className="w-full" />
            </div>
            {thesis && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="ex-title">Title</Label>
                    <Input id="ex-title" value={title} onChange={(e) => setTitle(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ex-author">Your name</Label>
                    <Input id="ex-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
                  </div>
                </div>
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox checked={toc} onCheckedChange={(v) => setToc(v === true)} /> Table of contents
                </Label>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={run} disabled={busy || !status?.pandoc || (format === "pdf" && !status.pdf)}>
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
            {busy ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
