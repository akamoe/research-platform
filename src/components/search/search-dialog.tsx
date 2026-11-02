import { Fragment, useEffect, useRef, useState } from "react"
import { BookOpenIcon, FileTextIcon, LoaderCircleIcon } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type SearchHit } from "@/lib/api"
import { openSourceAt } from "@/lib/jump"
import { navigate } from "@/lib/router"

/** Search every paper and note in the project, and jump to the page or note. */
export function SearchDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!open) return
    const query = q.trim()
    if (!query) {
      setHits(null)
      setLoading(false)
      return
    }
    const n = ++seq.current
    setLoading(true)
    const t = window.setTimeout(
      () =>
        api
          .search(projectId, query, 40)
          .then((h) => n === seq.current && setHits(h), () => n === seq.current && setHits([]))
          .finally(() => n === seq.current && setLoading(false)),
      180,
    )
    return () => window.clearTimeout(t)
  }, [q, open, projectId])

  const papers = (hits ?? []).filter((h) => h.kind === "source")
  const notes = dedupeNotes((hits ?? []).filter((h) => h.kind === "note"))

  const pick = (h: SearchHit) => {
    onOpenChange(false)
    if (h.kind === "source") openSourceAt(projectId, { sourceId: h.ref, page: h.page })
    else navigate({ name: "project", projectId, note: h.ref })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription>Search the text of your papers and notes</DialogDescription>
      </DialogHeader>
      <DialogContent className="top-[15%] translate-y-0 overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <Command shouldFilter={false} className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:text-muted-foreground">
          <div className="relative">
            <CommandInput value={q} onValueChange={setQ} placeholder="Search your papers and notes…" className="h-12" />
            {loading && <LoaderCircleIcon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          <CommandList className="max-h-[60vh]">
            {hits === null ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Finds words in the full text of every paper and note, and opens the page they're on.
              </p>
            ) : (
              !loading && <CommandEmpty>Nothing found for “{q.trim()}”.</CommandEmpty>
            )}
            {papers.length > 0 && (
              <CommandGroup heading="Papers">
                {papers.map((h) => (
                  <CommandItem key={`${h.ref}-${h.page}-${h.chunk}`} value={`${h.ref}-${h.page}-${h.chunk}`} onSelect={() => pick(h)} className="items-start gap-3 py-2.5">
                    <BookOpenIcon className="mt-0.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="truncate font-medium">{h.title}</span>
                        {h.page > 0 && <span className="shrink-0 text-xs text-muted-foreground">p. {h.page}</span>}
                      </div>
                      <Snippet text={h.snippet} />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {notes.length > 0 && (
              <CommandGroup heading="Notes">
                {notes.map((h) => (
                  <CommandItem key={`${h.ref}-${h.chunk}`} value={`note-${h.ref}-${h.chunk}`} onSelect={() => pick(h)} className="items-start gap-3 py-2.5">
                    <FileTextIcon className="mt-0.5 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{h.title}</span>
                      <Snippet text={h.snippet} />
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/** One result per note: its best passage. */
function dedupeNotes(hits: SearchHit[]) {
  const seen = new Set<string>()
  return hits.filter((h) => !seen.has(h.ref) && seen.add(h.ref))
}

/** Server snippets mark matched words with « »; show them as marks. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/«|»/)
  return (
    <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
      {parts.map((p, i) =>
        i % 2 ? (
          <mark key={i} className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground dark:bg-yellow-500/30">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </p>
  )
}
