import { useEffect, useState } from "react"
import { BookOpenIcon, CheckIcon, MessageSquareIcon, MoreHorizontalIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type ReadingState, type ReadingStatus, type Source } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

const hm = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ""}`)
const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "")

interface Props {
  projectId: string
  papers: Source[]
  chatOpen: boolean
  onToggleChat: () => void
}

export function ReadingView({ projectId, papers, chatOpen, onToggleChat }: Props) {
  const [s, setS] = useState<ReadingState | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    api.reading(projectId).then(setS, (e) => toast.error(e.message))
  }, [projectId])

  const run = (p: Promise<ReadingState>) => p.then(setS, (e) => toast.error(e.message))
  const set = (sid: string, status: ReadingStatus | null) => run(api.setReading(projectId, sid, status))
  const byId = new Map(papers.map((p) => [p.id, p]))
  const ids = (st: ReadingStatus) => (s?.order ?? []).filter((id) => s!.items[id]?.status === st && byId.has(id))
  const reading = ids("reading")
  const toRead = ids("to-read")
  const done = ids("read").sort((a, b) => (s!.items[b].finishedAt ?? "").localeCompare(s!.items[a].finishedAt ?? ""))
  const left = (id: string) => {
    const m = s?.minutes[id] ?? 0
    const p = s?.progress[id]
    return p && p.pages > 1 ? Math.max(1, Math.round(m * (1 - (p.maxPage - 1) / p.pages))) : m
  }
  const total = toRead.reduce((n, id) => n + left(id), 0)
  const notListed = papers.filter((p) => !s?.items[p.id])

  const move = (id: string, to: "top" | "up" | "down") => {
    if (!s) return
    const list = [...toRead]
    const i = list.indexOf(id)
    list.splice(i, 1)
    list.splice(to === "top" ? 0 : to === "up" ? Math.max(0, i - 1) : Math.min(list.length, i + 1), 0, id)
    // Keep the other statuses where they were.
    run(api.reorderReading(projectId, [...list, ...s.order.filter((x) => !list.includes(x))]))
  }

  const open = (id: string) => navigate({ name: "project", projectId, paper: id })

  const row = (id: string) => {
    const src = byId.get(id)!
    const e = s!.items[id]
    const p = s!.progress[id]
    const pct = p && p.pages ? Math.round((p.maxPage / p.pages) * 100) : 0
    return (
      <li key={id} className="group flex items-center gap-3 py-3" data-testid="reading-row">
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => open(id)}>
          <div className={cn("truncate text-sm", e.status === "read" && "text-muted-foreground")}>{src.title}</div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            {src.author && <span className="max-w-60 truncate">{src.author}</span>}
            {e.status === "read" ? (
              <span>Read {date(e.finishedAt)}</span>
            ) : (
              <>
                {src.pages > 0 && <span>{src.pages === 1 ? "1 page" : `${src.pages} pages`}</span>}
                <span>{p && e.status === "reading" ? `about ${hm(left(id))} left` : `about ${hm(s!.minutes[id] ?? 1)}`}</span>
                {p && e.status === "reading" && <span>· on p. {p.page}</span>}
              </>
            )}
          </div>
          {e.status === "reading" && p && <Progress value={pct} className="mt-2 h-1" aria-label="How far you've read" />}
        </button>
        {e.status !== "read" && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => set(id, "read")}
          >
            <CheckIcon /> Done
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="Options">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {e.status === "to-read" && (
              <>
                <DropdownMenuItem onSelect={() => move(id, "top")}>Read next</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => move(id, "up")}>Move up</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => move(id, "down")}>Move down</DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {e.status !== "reading" && <DropdownMenuItem onSelect={() => set(id, "reading")}>Reading now</DropdownMenuItem>}
            {e.status !== "to-read" && <DropdownMenuItem onSelect={() => set(id, "to-read")}>Back to “To read”</DropdownMenuItem>}
            {e.status !== "read" && <DropdownMenuItem onSelect={() => set(id, "read")}>Mark as read</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => set(id, null)}>Take off the list</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    )
  }

  const section = (label: string, list: string[], extra?: string) =>
    list.length > 0 && (
      <section className="mt-6">
        <h2 className="flex items-baseline gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label} <span className="tabular-nums">{list.length}</span>
          {extra && <span className="ml-auto font-normal tracking-normal normal-case">{extra}</span>}
        </h2>
        <ul className="mt-1 divide-y">{list.map(row)}</ul>
      </section>
    )

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">Reading list</span>
        <div className="ml-auto flex items-center gap-1">
          <Popover open={adding} onOpenChange={setAdding}>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <PlusIcon /> Add
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <Command>
                <CommandInput placeholder="Find a source…" />
                <CommandList>
                  <CommandEmpty>{papers.length ? "Every source is on the list." : "Add a source first."}</CommandEmpty>
                  <CommandGroup>
                    {notListed.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={`${p.title} ${p.id}`}
                        onSelect={() => {
                          set(p.id, "to-read")
                          setAdding(false)
                        }}
                      >
                        <BookOpenIcon className="text-muted-foreground" />
                        <span className="truncate">{p.title}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-8 text-muted-foreground", chatOpen && "bg-muted text-foreground")}
                onClick={onToggleChat}
                aria-label="Chat"
              >
                <MessageSquareIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-16">
          {s && !reading.length && !toRead.length && !done.length ? (
            <div className="mx-auto mt-16 max-w-md rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Keep track of what to read next. Press <span className="font-medium text-foreground">Add</span> to put sources on the list; papers you add from{" "}
              <span className="font-medium text-foreground">Find papers</span> land here too. Folio remembers the page you stopped on.
            </div>
          ) : s ? (
            <>
              {section("Reading now", reading)}
              {section("To read", toRead, total ? `about ${hm(total)} in all` : undefined)}
              {section("Read", done)}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
