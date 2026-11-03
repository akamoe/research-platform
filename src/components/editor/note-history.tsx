import { useEffect, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

type Version = { id: string; at: string; words: number }

const when = (iso: string) => {
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? `Today, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

/** Earlier versions of a note, kept as you write. Pick one to read it, then restore it if you want it back. */
export function NoteHistory({
  projectId,
  path,
  open,
  onOpenChange,
  beforeOpen,
  onRestore,
}: {
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

  useEffect(() => {
    if (!open) return
    setVersions(null)
    setPicked(null)
    setText(null)
    Promise.resolve(beforeOpen?.())
      .catch(() => {})
      .then(() => api.noteHistory(projectId, path))
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
    api.noteVersion(projectId, path, picked).then(
      (v) => setText(v.content),
      (e) => toast.error(e.message),
    )
  }, [picked, projectId, path])

  const restore = async () => {
    if (text === null) return
    try {
      await api.keepNoteVersion(projectId, path)
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
          <SheetDescription>Folio keeps a copy of this note every 10 minutes while you write.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1">
          <ul className="w-48 shrink-0 space-y-0.5 overflow-y-auto border-r p-2">
            {versions?.length === 0 && <li className="p-2 text-sm text-muted-foreground">No earlier versions yet.</li>}
            {versions?.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => setPicked(v.id)}
                  className={cn("w-full rounded-md px-2 py-1.5 text-left hover:bg-muted", picked === v.id && "bg-muted")}
                >
                  <div className="text-sm">{when(v.at)}</div>
                  <div className="text-xs text-muted-foreground">
                    {v.words} words
                  </div>
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
            {text !== null && <pre className="font-serif text-[15px] leading-relaxed whitespace-pre-wrap">{text}</pre>}
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
