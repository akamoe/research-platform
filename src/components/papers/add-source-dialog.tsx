import { useEffect, useState } from "react"
import { LoaderCircleIcon, UploadIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { api, type Source } from "@/lib/api"

/** Add a source by link (web page, YouTube, PDF link), by pasting text, or by choosing files. */
export function AddSourceDialog({
  projectId,
  open,
  onOpenChange,
  onAdded,
  onPickFiles,
}: {
  projectId: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onAdded: (s: Source) => void
  onPickFiles: () => void
}) {
  const [tab, setTab] = useState("link")
  const [url, setUrl] = useState("")
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setUrl("")
    setTitle("")
    setText("")
  }, [open])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const s = tab === "link" ? await api.addSourceLink(projectId, url) : await api.addSourceText(projectId, title, text)
      onAdded(s)
      onOpenChange(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const ready = tab === "link" ? !!url.trim() : !!text.trim()

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a source</DialogTitle>
          <DialogDescription>Something to read, watch or quote: it gets a reading note, and search and chat can use it.</DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            <TabsTrigger value="link">Link</TabsTrigger>
            <TabsTrigger value="text">Paste text</TabsTrigger>
            <TabsTrigger value="file">File</TabsTrigger>
          </TabsList>
          <TabsContent value="link" className="mt-3 grid gap-2">
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ready && submit()}
              placeholder="https://…"
              aria-label="Link"
            />
            <p className="text-xs text-muted-foreground">
              A web article, a YouTube video (its transcript is used) or a direct link to a PDF.
            </p>
          </TabsContent>
          <TabsContent value="text" className="mt-3 grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="src-title">Title</Label>
              <Input id="src-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional: the first line is used if empty" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="src-text">Text</Label>
              <Textarea
                id="src-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="Lecture notes, an interview transcript, an article behind a login…"
                className="max-h-72"
              />
            </div>
          </TabsContent>
          <TabsContent value="file" className="mt-3">
            <button
              onClick={() => {
                onOpenChange(false)
                onPickFiles()
              }}
              className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-8 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            >
              <UploadIcon className="size-5" />
              <span>Choose PDF, Word (.docx), Markdown or text files</span>
              <span className="text-xs">You can also drop files anywhere on the window.</span>
            </button>
          </TabsContent>
        </Tabs>
        {tab !== "file" && (
          <DialogFooter>
            <Button onClick={submit} disabled={!ready || busy}>
              {busy && <LoaderCircleIcon className="animate-spin" />}
              {busy ? (tab === "link" ? "Fetching…" : "Adding…") : "Add"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
