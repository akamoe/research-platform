import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Version = { id: string; at: string; words: number }

const day = (iso: string) => {
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return "Today"
  const y = new Date(now)
  y.setDate(now.getDate() - 1)
  if (d.toDateString() === y.toDateString()) return "Yesterday"
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" })
}
const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })

/** Earlier versions of a note, kept as you write. Pick one to read it, then restore it if you want it back. */
export function NoteHistory({
  projectId,
  path,
  open,
  onOpenChange,
  beforeOpen,
  onRestore,
  kind = "note",
}: {
  /** A note, or a file in the LaTeX tab. */
  kind?: "note" | "latex"
  projectId: string
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Wait for unsaved edits, so the list includes them. */
  beforeOpen?: () => Promise<unknown>
  onRestore: (markdown: string) => void
}) {
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  const calls =
    kind === "latex"
      ? { list: api.latexHistory, version: api.latexVersion, keep: api.keepLatexVersion }
      : { list: api.noteHistory, version: api.noteVersion, keep: api.keepNoteVersion }

  useEffect(() => {
    if (!open) return
    setVersions(null)
    setPicked(null)
    setText(null)
    Promise.resolve(beforeOpen?.())
      .catch(() => {})
      .then(() => calls.list(projectId, path))
      .then(
        (v) => {
          setVersions(v)
          setPicked(v[0]?.id ?? null)
        },
        (e) => toast.error(e.message),
      )
  }, [open, projectId, path]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!picked) return
    setText(null)
    calls.version(projectId, path, picked).then(
      (v) => setText(v.content),
      (e) => toast.error(e.message),
    )
  }, [picked, projectId, path])

  const restore = async () => {
    if (text === null) return
    try {
      await calls.keep(projectId, path)
      onRestore(text)
      onOpenChange(false)
      toast.success("Restored. The version you replaced is still in History.")
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>Folio keeps a copy of this {kind === "latex" ? "file" : "note"} every 10 minutes while you write.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1">
          <ul className="w-48 shrink-0 space-y-0.5 overflow-y-auto border-r p-2">
            {versions?.length === 0 && <li className="p-2 text-sm text-muted-foreground">No earlier versions yet.</li>}
            {versions?.map((v, i) => (
              <li key={v.id}>
                {(i === 0 || day(versions[i - 1].at) !== day(v.at)) && (
                  <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{day(v.at)}</div>
                )}
                <button
                  type="button"
                  onClick={() => setPicked(v.id)}
                  className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-muted", picked === v.id && "bg-muted")}
                >
                  <div className="text-sm">{time(v.at)}</div>
                  <div className="text-xs text-muted-foreground">{v.words} words</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
            {text !== null && <pre className={cn("leading-relaxed whitespace-pre-wrap", kind === "latex" ? "font-mono text-[13px]" : "font-serif text-[15px]")}>{text}</pre>}
          </div>
        </div>
        <SheetFooter className="flex-row justify-end border-t">
          <Button disabled={text === null} onClick={restore}>
            Restore this version
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
