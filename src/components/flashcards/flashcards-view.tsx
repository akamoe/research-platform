import { useCallback, useEffect, useMemo, useState } from "react"
import { LoaderCircleIcon, MessageSquareIcon, MoreHorizontalIcon, PlusIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type FlashRating, type Flashcard, type Highlight, type Source } from "@/lib/api"
import { openSourceAt } from "@/lib/jump"
import { cn } from "@/lib/utils"

const RATINGS: { id: FlashRating; label: string; key: string }[] = [
  { id: "again", label: "Again", key: "1" },
  { id: "hard", label: "Hard", key: "2" },
  { id: "good", label: "Good", key: "3" },
  { id: "easy", label: "Easy", key: "4" },
]
const span = (days: number) => (days === 0 ? "10 min" : days < 30 ? `${days} d` : days < 365 ? `${Math.round(days / 30)} mo` : `${(days / 365).toFixed(1)} y`)
const dueLabel = (iso: string) => {
  const t = Date.parse(iso)
  if (t <= Date.now()) return "Due"
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((day(new Date(t)) - day(new Date())) / 86400_000)
  return days === 0 ? "Later today" : days === 1 ? "Tomorrow" : `In ${days} days`
}
const isDue = (c: Flashcard) => !c.suspended && Date.parse(c.due) <= Date.now()

interface Props {
  projectId: string
  papers: Source[]
  chatOpen: boolean
  onToggleChat: () => void
}

export function FlashcardsView({ projectId, papers, chatOpen, onToggleChat }: Props) {
  const [cards, setCards] = useState<Flashcard[] | null>(null)
  const [studying, setStudying] = useState(false)
  const [making, setMaking] = useState<string | null>(null)
  const [editing, setEditing] = useState<Flashcard | "new" | null>(null)
  const [filter, setFilter] = useState("all")

  const load = useCallback(() => api.flashcards(projectId).then(setCards, (e) => toast.error(e.message)), [projectId])
  useEffect(() => {
    load()
  }, [load])

  const title = (sid?: string) => papers.find((p) => p.id === sid)?.title
  const due = useMemo(() => (cards ?? []).filter(isDue), [cards])
  const shown = (cards ?? []).filter((c) => filter === "all" || c.sourceId === filter || (filter === "none" && !c.sourceId))

  const make = async (s: Source) => {
    setMaking(s.id)
    try {
      const r = await api.generateFlashcards(projectId, s.id)
      await load()
      if (r.added.length) toast.success(`${r.added.length} card${r.added.length === 1 ? "" : "s"} from your highlights in ${s.title}`)
      else toast(`No new cards: every highlight in ${s.title} already has one, or is too short to ask about`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setMaking(null)
    }
  }

  const replace = (c: Flashcard) => setCards((cs) => cs?.map((x) => (x.id === c.id ? c : x)) ?? cs)

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">Flashcards</span>
        <div className="ml-auto flex items-center gap-1">
          {!studying && (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8" disabled={!!making}>
                    {making ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />} Make cards
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-72">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    The AI asks a question for each highlight; the answer is your highlight.
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {papers.map((s) => (
                    <DropdownMenuItem key={s.id} onSelect={() => make(s)}>
                      <span className="truncate">{s.title}</span>
                    </DropdownMenuItem>
                  ))}
                  {!papers.length && <DropdownMenuItem disabled>Add a source and highlight it first</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditing("new")}>
                <PlusIcon /> New card
              </Button>
            </>
          )}
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

      {studying ? (
        <Study projectId={projectId} queue={due} title={title} onReviewed={replace} onDone={() => setStudying(false)} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-16">
            {cards && !cards.length ? (
              <div className="mx-auto mt-16 max-w-md rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Turn what you highlighted into questions to test yourself. Pick a source under <span className="font-medium text-foreground">Make cards</span>, or
                write your own with <span className="font-medium text-foreground">New card</span>. Cards you know well come back less often.
              </div>
            ) : cards ? (
              <>
                <div className="flex items-center gap-4 rounded-lg border p-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-2xl font-semibold tabular-nums">{due.length}</div>
                    <div className="text-sm text-muted-foreground">
                      {due.length === 1 ? "card to review" : "cards to review"} · {cards.length} in all
                    </div>
                  </div>
                  <Button disabled={!due.length} onClick={() => setStudying(true)}>
                    Study
                  </Button>
                </div>
                <div className="mt-6 flex items-center gap-2">
                  <span className="text-sm font-medium">All cards</span>
                  <Select value={filter} onValueChange={setFilter}>
                    <SelectTrigger className="ml-auto h-8 w-56" aria-label="Source">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Every source</SelectItem>
                      {[...new Set(cards.map((c) => c.sourceId).filter(Boolean))].map((sid) => (
                        <SelectItem key={sid} value={sid!}>
                          {title(sid) ?? "Removed source"}
                        </SelectItem>
                      ))}
                      {cards.some((c) => !c.sourceId) && <SelectItem value="none">Not from a source</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <ul className="mt-2 divide-y">
                  {shown.map((c) => (
                    <li key={c.id} className={cn("flex items-start gap-3 py-3", c.suspended && "opacity-50")} data-testid="card-row">
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setEditing(c)}>
                        <p className="text-sm">{c.front}</p>
                        <p className="mt-0.5 line-clamp-1 font-serif text-sm text-muted-foreground italic">{c.back}</p>
                      </button>
                      <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                        {c.sourceId && (
                          <button
                            type="button"
                            className="max-w-40 truncate rounded bg-muted px-1.5 py-0.5 hover:text-foreground"
                            onClick={() => openSourceAt(projectId, { sourceId: c.sourceId!, page: c.page ?? 1, quote: c.back })}
                          >
                            {title(c.sourceId) ?? "Source"}
                            {c.page ? `, p. ${c.page}` : ""}
                          </button>
                        )}
                        <span className="w-20 text-right">{c.suspended ? "Paused" : dueLabel(c.due)}</span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7" aria-label="Card options">
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setEditing(c)}>Edit</DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => api.updateFlashcard(projectId, c.id, { suspended: !c.suspended }).then((x) => replace({ ...c, ...x }), (e) => toast.error(e.message))}
                            >
                              {c.suspended ? "Study it again" : "Pause it"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                api.deleteFlashcard(projectId, c.id).then(() => setCards((cs) => cs?.filter((x) => x.id !== c.id) ?? cs), (e) => toast.error(e.message))
                              }
                            >
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        </div>
      )}

      <CardDialog
        projectId={projectId}
        papers={papers}
        card={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => {
          setEditing(null)
          load()
        }}
      />
    </div>
  )
}

function Study({
  projectId,
  queue,
  title,
  onReviewed,
  onDone,
}: {
  projectId: string
  queue: Flashcard[]
  title: (sid?: string) => string | undefined
  onReviewed: (c: Flashcard) => void
  onDone: () => void
}) {
  // The session's own list: cards answered "Again" come back at the end.
  const [list, setList] = useState(() => [...queue].sort(() => Math.random() - 0.5))
  const [shown, setShown] = useState(false)
  const [done, setDone] = useState(0)
  const card = list[0]

  const rate = useCallback(
    async (r: FlashRating) => {
      if (!card) return
      setShown(false)
      setList((l) => (r === "again" ? [...l.slice(1), card] : l.slice(1)))
      if (r !== "again") setDone((n) => n + 1)
      try {
        const saved = await api.reviewFlashcard(projectId, card.id, r)
        onReviewed(saved)
        setList((l) => l.map((x) => (x.id === saved.id ? saved : x)))
      } catch (e) {
        toast.error((e as Error).message)
      }
    },
    [card, projectId, onReviewed],
  )

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) return
      if (!shown && (e.key === " " || e.key === "Enter")) {
        e.preventDefault()
        setShown(true)
      } else if (shown) {
        const r = RATINGS.find((x) => x.key === e.key)
        if (r) rate(r.id)
      }
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  }, [shown, rate])

  if (!card)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          That's all for now: {done} card{done === 1 ? "" : "s"} reviewed. The next ones come back when they're due.
        </p>
        <Button variant="outline" onClick={onDone}>
          Back to cards
        </Button>
      </div>
    )

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pt-10 pb-16">
      <div className="flex w-full max-w-xl items-center text-xs text-muted-foreground">
        <span className="tabular-nums">{list.length} left</span>
        <Button variant="ghost" size="sm" className="ml-auto h-7" onClick={onDone}>
          Stop
        </Button>
      </div>
      <div className="mt-3 w-full max-w-xl rounded-xl border bg-card p-8 shadow-xs" data-testid="study-card">
        <p className="text-center font-serif text-xl leading-snug">{card.front}</p>
        {shown && (
          <div className="mt-6 border-t pt-6">
            <p className="font-serif leading-relaxed whitespace-pre-wrap">{card.back}</p>
            {card.sourceId && (
              <button
                type="button"
                className="mt-3 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => openSourceAt(projectId, { sourceId: card.sourceId!, page: card.page ?? 1, quote: card.back })}
              >
                {title(card.sourceId) ?? "Source"}
                {card.page ? `, p. ${card.page}` : ""}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="mt-6 flex w-full max-w-xl justify-center gap-2">
        {!shown ? (
          <Button onClick={() => setShown(true)}>
            Show answer <span className="text-xs opacity-60">Space</span>
          </Button>
        ) : (
          RATINGS.map((r) => (
            <Button key={r.id} variant={r.id === "good" ? "default" : "outline"} className="flex-1 flex-col gap-0 py-6" onClick={() => rate(r.id)}>
              <span>{r.label}</span>
              <span className="text-[11px] font-normal opacity-70">{span(card.next[r.id])}</span>
            </Button>
          ))
        )}
      </div>
      {shown && <p className="mt-3 text-xs text-muted-foreground">Keys 1 to 4</p>}
    </div>
  )
}

function CardDialog({
  projectId,
  papers,
  card,
  onOpenChange,
  onSaved,
}: {
  projectId: string
  papers: Source[]
  card: Flashcard | "new" | null
  onOpenChange: (o: boolean) => void
  onSaved: () => void
}) {
  const [front, setFront] = useState("")
  const [back, setBack] = useState("")
  const [sourceId, setSourceId] = useState<string>("")
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [picked, setPicked] = useState<Highlight | null>(null)
  const [saving, setSaving] = useState(false)
  const isNew = card === "new"

  useEffect(() => {
    if (!card) return
    setFront(card === "new" ? "" : card.front)
    setBack(card === "new" ? "" : card.back)
    setSourceId("")
    setPicked(null)
  }, [card])
  useEffect(() => {
    setHighlights([])
    if (sourceId) api.highlights(projectId, sourceId).then((h) => setHighlights(h.filter((x) => x.text?.trim())), () => {})
  }, [projectId, sourceId])

  const save = async () => {
    setSaving(true)
    try {
      if (card === "new")
        await api.createFlashcard(projectId, {
          front,
          back,
          ...(picked && sourceId ? { sourceId, highlightId: picked.id, page: picked.pageIndex + 1 } : {}),
        })
      else if (card) await api.updateFlashcard(projectId, card.id, { front, back })
      onSaved()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!card} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? "New card" : "Edit card"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {isNew && !!papers.length && (
            <div className="grid grid-cols-2 gap-2">
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger className="w-full" aria-label="From a source">
                  <SelectValue placeholder="Answer from a highlight…" />
                </SelectTrigger>
                <SelectContent>
                  {papers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={picked?.id ?? ""}
                onValueChange={(id) => {
                  const h = highlights.find((x) => x.id === id) ?? null
                  setPicked(h)
                  if (h) setBack(h.text!.trim())
                }}
                disabled={!highlights.length}
              >
                <SelectTrigger className="w-full" aria-label="Highlight">
                  <SelectValue placeholder={sourceId && !highlights.length ? "No highlights" : "Highlight"} />
                </SelectTrigger>
                <SelectContent className="max-w-md">
                  {highlights.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      <span className="truncate">
                        p. {h.pageIndex + 1}: {h.text!.slice(0, 70)}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="fc-front">Question</Label>
            <Textarea id="fc-front" value={front} onChange={(e) => setFront(e.target.value)} className="min-h-16" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="fc-back">Answer</Label>
            <Textarea id="fc-back" value={back} onChange={(e) => setBack(e.target.value)} className="min-h-24 font-serif" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || !front.trim() || !back.trim()} onClick={save}>
            {isNew ? "Add card" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
