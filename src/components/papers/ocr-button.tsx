import { useEffect, useRef, useState } from "react"
import { LoaderCircleIcon, ScanTextIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, type OcrInfo, type OcrJob, type Source } from "@/lib/api"
import { unreadableNote } from "./source-kind"

const pageWord = (n: number) => (n === 1 ? "page" : "pages")

/**
 * What chat can't read in a PDF (scanned pages), with a button to read those pages with OCR,
 * and the progress while it runs (also when it started by itself after an upload).
 */
export function OcrButton({ projectId, source, onChanged }: { projectId: string; source: Source; onChanged: (s: Source) => void }) {
  const [info, setInfo] = useState<OcrInfo | null>(null)
  const [job, setJob] = useState<OcrJob | null>(null)
  const [open, setOpen] = useState(false)
  const [langs, setLangs] = useState<string[]>([])
  const note = unreadableNote(source)
  const scans = note !== null && (source.type ?? "pdf") === "pdf"
  const seen = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!scans) return
    api.ocr(projectId, source.id).then((i) => {
      setInfo(i)
      setJob(i.job)
      seen.current = i.job?.finishedAt
      setLangs(i.last ?? (navigator.language.startsWith("ar") ? ["ara", "eng"] : ["eng"]))
    }, () => {})
  }, [projectId, source.id, scans])

  const running = job?.state === "waiting" || job?.state === "downloading" || job?.state === "reading"
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(async () => {
      try {
        const i = await api.ocr(projectId, source.id)
        setJob(i.job)
        if (i.job && i.job.finishedAt && i.job.finishedAt !== seen.current) {
          seen.current = i.job.finishedAt
          if (i.job.state === "error") toast.error(`OCR stopped: ${i.job.error}`)
          else {
            const read = i.job.total - (i.job.empty?.length ?? 0)
            toast.success(read ? `Read ${read} scanned ${pageWord(read)}. Chat and search can use ${read === 1 ? "it" : "them"} now.` : "OCR found no words on those pages.", {
              description: i.job.empty?.length && read ? `No words found on p. ${i.job.empty.join(", ")}.` : undefined,
            })
          }
          onChanged(await api.source(projectId, source.id))
        }
      } catch {}
    }, 1500)
    return () => window.clearInterval(t)
  }, [running, projectId, source.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!scans && !running) return null

  const startOcr = async () => {
    setOpen(false)
    try {
      setJob(await api.startOcr(projectId, source.id, langs))
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (running)
    return (
      <span className="ml-auto flex min-w-0 items-center gap-1.5 pr-1 text-xs text-muted-foreground" data-testid="ocr-progress">
        <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin" />
        <span className="truncate">
          {job!.state === "waiting" ? "Waiting for another PDF's OCR…" : job!.state === "downloading" ? "Getting the OCR language files…" : `Reading scanned page ${Math.min(job!.done + 1, job!.total)} of ${job!.total}…`}
        </span>
      </span>
    )

  const missing = info ? langs.filter((l) => !info.installed.includes(l)) : []
  return (
    <span className="ml-auto flex min-w-0 items-center gap-1 pr-1 text-xs text-muted-foreground">
      <span className="truncate">{note}</span>
      {info && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-xs">
              <ScanTextIcon className="size-3.5" /> Read with OCR
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <p className="text-sm">Read the words on the scanned pages.</p>
            <p className="mt-1 text-xs text-muted-foreground">It runs on this computer and takes a few seconds a page. Pick the languages the pages are in.</p>
            <div className="mt-3 grid max-h-56 grid-cols-2 gap-x-2 gap-y-2 overflow-y-auto">
              {info.langs.map((l) => (
                <div key={l.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`ocr-${l.id}`}
                    checked={langs.includes(l.id)}
                    disabled={!langs.includes(l.id) && langs.length >= 4}
                    onCheckedChange={(v) => setLangs((ls) => (v === true ? [...ls, l.id] : ls.filter((x) => x !== l.id)))}
                  />
                  <Label htmlFor={`ocr-${l.id}`} className="truncate text-sm font-normal">
                    {l.name}
                  </Label>
                </div>
              ))}
            </div>
            {missing.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                Folio downloads {missing.length === 1 ? "this language" : "these languages"} once (1 to 4 MB each), then reads scans offline. New scanned PDFs are then read by themselves.
              </p>
            )}
            <Button size="sm" className="mt-3 w-full" disabled={!langs.length} onClick={startOcr}>
              Read {source.scannedPages?.length ? `${source.scannedPages.length} ${pageWord(source.scannedPages.length)}` : "the pages"}
            </Button>
          </PopoverContent>
        </Popover>
      )}
    </span>
  )
}
