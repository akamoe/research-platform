import { useEffect, useState } from "react"
import { BookOpenIcon, ExternalLinkIcon, LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Passage, type Source } from "@/lib/api"
import { openSourceAt } from "@/lib/jump"
import { cn } from "@/lib/utils"

/** Citation links the chat writes: #src/<paperId>/<page>/<passage>. */
export function parseSourceLink(href?: string) {
  const m = href?.match(/^#src\/([\w-]+)\/(\d+)(?:\/(\d+))?$/)
  return m ? { sourceId: m[1], page: Number(m[2]), chunk: Number(m[3] ?? 0) } : null
}

/** A small citation chip in a chat answer. Click to read the passage, then open the PDF there. */
export function SourceCite({ projectId, href, children }: { projectId: string; href: string; children: React.ReactNode }) {
  const target = parseSourceLink(href)!
  const [open, setOpen] = useState(false)
  const [passage, setPassage] = useState<Passage | null | undefined>(undefined)
  useEffect(() => {
    if (!open || passage !== undefined) return
    api.passage(projectId, target.sourceId, target.page, target.chunk).then(setPassage, () => setPassage(null))
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "mx-0.5 inline rounded-sm bg-muted px-1 py-px align-baseline font-sans text-[0.85em] text-muted-foreground no-underline",
            "hover:bg-accent hover:text-foreground",
            open && "bg-accent text-foreground",
          )}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <div className="border-b px-3 py-2">
          <p className="truncate text-sm font-medium">{passage?.title ?? "…"}</p>
          {target.page > 0 && <p className="text-xs text-muted-foreground">Page {target.page}</p>}
        </div>
        <div className="max-h-64 overflow-y-auto px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
          {passage === undefined ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : passage === null ? (
            "This passage isn't there any more. The paper may have been removed."
          ) : (
            <p className="whitespace-pre-line">{passage.text.replace(/([^\n])\n(?!\n)/g, "$1 ")}</p>
          )}
        </div>
        {passage && (
          <div className="flex justify-end border-t p-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                openSourceAt(projectId, target)
              }}
            >
              <ExternalLinkIcon /> Open {target.page > 0 ? `page ${target.page}` : "paper"}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Which papers the project chat reads. */
export function ChatSources({ projectId }: { projectId: string }) {
  const [list, setList] = useState<Source[] | null>(null)
  const load = () => api.sources(projectId).then(setList, () => setList([]))
  useEffect(() => {
    load()
  }, [projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const readable = (list ?? []).filter((s) => s.hasText)
  const on = readable.filter((s) => s.inChat !== false).length
  if (!list || !list.length) return null

  const set = async (s: Source, inChat: boolean) => {
    setList((l) => l?.map((x) => (x.id === s.id ? { ...x, inChat } : x)) ?? l)
    try {
      await api.setSourceInChat(projectId, s.id, inChat)
    } catch (err) {
      toast.error((err as Error).message)
      load()
    }
  }

  return (
    <Popover onOpenChange={(o) => o && load()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs",
                on ? "bg-muted text-foreground" : "text-muted-foreground line-through",
              )}
            >
              <BookOpenIcon className="size-3 shrink-0" />
              {on === readable.length ? `${on} paper${on === 1 ? "" : "s"}` : `${on} of ${readable.length} papers`}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Papers the assistant searches to answer</TooltipContent>
      </Tooltip>
      <PopoverContent align="start" side="top" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <p className="text-sm font-medium">Papers in this chat</p>
          {readable.length > 1 && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                const want = on < readable.length
                for (const s of readable) if ((s.inChat !== false) !== want) set(s, want)
              }}
            >
              {on < readable.length ? "Select all" : "Clear all"}
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {list.map((s) => (
            <label
              key={s.id}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                !s.hasText && "cursor-default opacity-50 hover:bg-transparent",
              )}
            >
              <Checkbox
                className="mt-0.5"
                disabled={!s.hasText}
                checked={s.hasText && s.inChat !== false}
                onCheckedChange={(v) => set(s, v === true)}
              />
              <span className="min-w-0">
                <span className="line-clamp-2 leading-snug">{s.title}</span>
                {!s.hasText && <span className="block text-xs text-muted-foreground">No text to read (scanned PDF)</span>}
              </span>
            </label>
          ))}
        </div>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          The assistant searches these for passages that match your question and links to the page it used.
        </p>
      </PopoverContent>
    </Popover>
  )
}
