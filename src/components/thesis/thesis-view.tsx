import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  FilePlusIcon,
  FileTextIcon,
  LinkIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SigmaIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Chapter, type ChapterStatus, type LatexFile, type NoteFile, type ThesisPlan, type ThesisState } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

const STATUS: Record<ChapterStatus, { label: string; icon: typeof CircleIcon; className: string }> = {
  todo: { label: "Not started", icon: CircleIcon, className: "text-muted-foreground" },
  drafting: { label: "Drafting", icon: CircleDashedIcon, className: "text-amber-600 dark:text-amber-400" },
  revising: { label: "Revising", icon: CircleDotIcon, className: "text-sky-600 dark:text-sky-400" },
  done: { label: "Done", icon: CircleCheckIcon, className: "text-emerald-600 dark:text-emerald-400" },
}

/** A common thesis shape, with each chapter's share of the word goal. The student renames and reshapes it. */
const OUTLINE: [string, number][] = [
  ["Introduction", 0.1],
  ["Literature review", 0.25],
  ["Methodology", 0.15],
  ["Results", 0.2],
  ["Discussion", 0.2],
  ["Conclusion", 0.1],
]

const newId = () => Math.random().toString(36).slice(2, 10)
const fmt = (n: number) => n.toLocaleString()

const toDate = (s?: string) => {
  if (!s) return undefined
  const [y, m, d] = s.split("-").map(Number)
  return new Date(y, m - 1, d)
}
const fromDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const today = () => fromDate(new Date())
function daysUntil(s: string) {
  const ms = toDate(s)!.getTime() - toDate(today())!.getTime()
  return Math.round(ms / 86400_000)
}
function showDate(s: string) {
  const d = toDate(s)!
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" })
}

function DatePick({
  value,
  onChange,
  placeholder,
  overdue,
  className,
}: {
  value?: string
  onChange: (v?: string) => void
  placeholder: string
  overdue?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2 font-normal text-muted-foreground", overdue && "text-destructive", className)}
        >
          <CalendarIcon className="size-3.5" />
          {value ? showDate(value) : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <Calendar
          mode="single"
          selected={toDate(value)}
          defaultMonth={toDate(value)}
          onSelect={(d) => {
            onChange(d ? fromDate(d) : undefined)
            setOpen(false)
          }}
        />
        {value && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-muted-foreground"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** A number that becomes an input on click. */
function GoalInput({ value, onChange, label }: { value?: number; onChange: (v?: number) => void; label: string }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState("")
  if (editing)
    return (
      <Input
        autoFocus
        aria-label={label}
        className="h-7 w-24 px-2 text-right text-sm tabular-nums"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, "").slice(0, 7))}
        onBlur={() => {
          onChange(text ? Number(text) : undefined)
          setEditing(false)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          if (e.key === "Escape") setEditing(false)
        }}
      />
    )
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded px-1 tabular-nums hover:bg-muted"
      onClick={() => {
        setText(value ? String(value) : "")
        setEditing(true)
      }}
    >
      {value ? fmt(value) : "set goal"}
    </button>
  )
}

function InlineTitle({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const [text, setText] = useState(value)
  return (
    <Input
      autoFocus
      aria-label="Chapter title"
      className="h-7 px-2"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => {
        if (text.trim()) onChange(text.trim())
        onDone()
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        if (e.key === "Escape") onDone()
      }}
    />
  )
}

interface Props {
  projectId: string
  notes: NoteFile[]
  chatOpen: boolean
  onToggleChat: () => void
  onNotesChanged: () => void
}

export function ThesisView({ projectId, notes, chatOpen, onToggleChat, onNotesChanged }: Props) {
  const [state, setState] = useState<ThesisState | null>(null)
  const [plan, setPlan] = useState<ThesisPlan | null>(null)
  const [texFiles, setTexFiles] = useState<LatexFile[]>([])
  const [renaming, setRenaming] = useState<string | null>(null)
  const [milestone, setMilestone] = useState("")
  const saving = useRef(Promise.resolve())
  const planRef = useRef<ThesisPlan | null>(null)

  const load = useCallback(
    () =>
      api.thesis(projectId).then((s) => {
        setState(s)
        if (!planRef.current) {
          planRef.current = s.plan
          setPlan(s.plan)
        }
      }, (e) => toast.error(e.message)),
    [projectId],
  )
  useEffect(() => {
    load()
    api.latex(projectId).then((l) => setTexFiles(l.files.filter((f) => f.text && f.path.endsWith(".tex"))), () => {})
    const onFocus = () => load()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [projectId, load])

  /** Change the plan now, save it in order behind any earlier save. */
  const change = (fn: (p: ThesisPlan) => ThesisPlan) => {
    if (!planRef.current) return
    const next = fn(planRef.current)
    planRef.current = next
    setPlan(next)
    saving.current = saving.current.then(() =>
      api.saveThesis(projectId, next).then(setState, (e) => {
        toast.error(e.message)
      }),
    )
  }
  const changeChapter = (id: string, patch: Partial<Chapter>) =>
    change((p) => ({ ...p, chapters: p.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c)) }))

  const useOutline = () => {
    const goal = plan?.goal ?? 15000
    change((p) => ({
      ...p,
      goal,
      chapters: OUTLINE.map(([title, share]) => ({ id: newId(), title, goal: Math.round((goal * share) / 50) * 50, status: "todo" })),
    }))
  }
  const addChapter = () => {
    const id = newId()
    change((p) => ({ ...p, chapters: [...p.chapters, { id, title: `Chapter ${p.chapters.length + 1}`, status: "todo" }] }))
    setRenaming(id)
  }
  const move = (id: string, by: number) =>
    change((p) => {
      const i = p.chapters.findIndex((c) => c.id === id)
      const j = i + by
      if (j < 0 || j >= p.chapters.length) return p
      const chapters = [...p.chapters]
      ;[chapters[i], chapters[j]] = [chapters[j], chapters[i]]
      return { ...p, chapters }
    })
  const removeChapter = (ch: Chapter) => {
    const before = plan
    change((p) => ({ ...p, chapters: p.chapters.filter((c) => c.id !== ch.id) }))
    toast(`Removed “${ch.title}”`, {
      description: ch.doc ? "Its file is untouched." : undefined,
      action: { label: "Undo", onClick: () => before && change(() => before) },
    })
  }
  const createNote = async (ch: Chapter) => {
    try {
      const { path } = await api.createNote(projectId, ch.title, `# ${ch.title}\n\n`)
      changeChapter(ch.id, { doc: { kind: "note", path } })
      onNotesChanged()
      navigate({ name: "project", projectId, note: path })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  const open = (ch: Chapter) => {
    if (!ch.doc) return
    if (ch.doc.kind === "note") navigate({ name: "project", projectId, note: ch.doc.path })
    else {
      try {
        localStorage.setItem(`rp-latex-file:${projectId}`, ch.doc.path)
      } catch {}
      navigate({ name: "project", projectId, view: "latex" })
    }
  }
  const addMilestone = (e: React.FormEvent) => {
    e.preventDefault()
    const title = milestone.trim()
    if (!title) return
    change((p) => ({ ...p, milestones: [...p.milestones, { id: newId(), title, done: false }] }))
    setMilestone("")
  }

  const userNotes = notes.filter((n) => !n.path.startsWith("Papers/"))
  const total = state?.total ?? 0
  const goal = plan?.goal ?? plan?.chapters.reduce((a, c) => a + (c.goal ?? 0), 0) ?? 0
  const left = plan?.submission ? daysUntil(plan.submission) : null
  const perDay = left && left > 0 && goal > total ? Math.ceil((goal - total) / left) : null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">Thesis</span>
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-8 text-muted-foreground", chatOpen && "bg-muted text-foreground")}
                onClick={onToggleChat}
              >
                <MessageSquareIcon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {plan && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 pt-4 pb-16">
            {/* Overall progress */}
            <section className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
                <div>
                  <p className="font-serif text-3xl tabular-nums">
                    {fmt(total)}
                    <span className="text-base text-muted-foreground"> / </span>
                    <span className="text-base text-muted-foreground">
                      <GoalInput label="Word goal" value={plan.goal ?? (goal || undefined)} onChange={(v) => change((p) => ({ ...p, goal: v }))} /> words
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {state && state.today > 0 ? `+${fmt(state.today)} today` : "No new words today yet"}
                    {state && state.week > 0 ? ` · +${fmt(state.week)} this week` : ""}
                    {perDay ? ` · about ${fmt(perDay)} a day to reach your goal` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span>Submission</span>
                  <DatePick
                    value={plan.submission}
                    placeholder="Set date"
                    onChange={(v) => change((p) => ({ ...p, submission: v }))}
                    className={cn(left !== null && left < 0 && "text-destructive")}
                  />
                  {left !== null && (
                    <span className={cn("text-xs", left < 14 && "text-destructive")}>
                      {left > 1 ? `${left} days left` : left === 1 ? "tomorrow" : left === 0 ? "today" : `${-left} days ago`}
                    </span>
                  )}
                </div>
              </div>
              <Progress value={goal ? Math.min(100, (total / goal) * 100) : 0} aria-label="Words written" />
            </section>

            {/* Chapters */}
            <section className="mt-10">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Chapters</h2>
                {plan.chapters.length > 0 && (
                  <Button variant="ghost" size="sm" className="h-7 text-muted-foreground" onClick={addChapter}>
                    <PlusIcon /> Add chapter
                  </Button>
                )}
              </div>
              {!plan.chapters.length ? (
                <div className="mt-3 rounded-lg border border-dashed p-8 text-center">
                  <p className="text-sm text-muted-foreground">Plan your chapters, give each a word goal and a date, and link it to the note or LaTeX file you write it in. Words are counted for you.</p>
                  <div className="mt-4 flex justify-center gap-2">
                    <Button variant="outline" size="sm" onClick={useOutline}>
                      Start from a standard outline
                    </Button>
                    <Button variant="ghost" size="sm" onClick={addChapter}>
                      <PlusIcon /> Add chapter
                    </Button>
                  </div>
                </div>
              ) : (
                <ul className="mt-2 divide-y">
                  {plan.chapters.map((ch, i) => {
                    const S = STATUS[ch.status]
                    const words = state?.words[ch.id]
                    const overdue = !!ch.due && ch.status !== "done" && ch.due < today()
                    return (
                      <li key={ch.id} className="group flex items-center gap-2 py-2.5" data-testid="chapter">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className={cn("size-7 shrink-0", S.className)} aria-label={`Status: ${S.label}`}>
                              <S.icon className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start">
                            <DropdownMenuRadioGroup value={ch.status} onValueChange={(v) => changeChapter(ch.id, { status: v as ChapterStatus })}>
                              {(Object.keys(STATUS) as ChapterStatus[]).map((k) => {
                                const I = STATUS[k].icon
                                return (
                                  <DropdownMenuRadioItem key={k} value={k}>
                                    <I className={STATUS[k].className} /> {STATUS[k].label}
                                  </DropdownMenuRadioItem>
                                )
                              })}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <div className="min-w-0 flex-1">
                          {renaming === ch.id ? (
                            <InlineTitle value={ch.title} onChange={(title) => changeChapter(ch.id, { title })} onDone={() => setRenaming(null)} />
                          ) : (
                            <>
                              <button
                                type="button"
                                className={cn("block max-w-full truncate text-left text-sm", ch.doc && "hover:underline", ch.status === "done" && "text-muted-foreground")}
                                onClick={() => (ch.doc ? open(ch) : setRenaming(ch.id))}
                              >
                                {ch.title}
                              </button>
                              <LinkMenu
                                chapter={ch}
                                notes={userNotes}
                                texFiles={texFiles}
                                missing={words === null}
                                onLink={(doc) => changeChapter(ch.id, { doc })}
                                onCreate={() => createNote(ch)}
                              />
                            </>
                          )}
                        </div>

                        <div className="hidden w-36 shrink-0 sm:block">
                          <div className="flex justify-end text-xs text-muted-foreground tabular-nums">
                            {ch.doc ? fmt(words ?? 0) : "–"} /{" "}
                            <GoalInput label={`Word goal for ${ch.title}`} value={ch.goal} onChange={(goal) => changeChapter(ch.id, { goal })} />
                          </div>
                          {ch.goal ? <Progress className="mt-1 h-1" value={Math.min(100, ((words ?? 0) / ch.goal) * 100)} /> : null}
                        </div>

                        <DatePick
                          value={ch.due}
                          placeholder="Due"
                          overdue={overdue}
                          className={cn("w-24 justify-start", !ch.due && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                          onChange={(due) => changeChapter(ch.id, { due })}
                        />

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={`More for ${ch.title}`}>
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setRenaming(ch.id)}>
                              <PencilIcon /> Rename
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={i === 0} onSelect={() => move(ch.id, -1)}>
                              <ArrowUpIcon /> Move up
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={i === plan.chapters.length - 1} onSelect={() => move(ch.id, 1)}>
                              <ArrowDownIcon /> Move down
                            </DropdownMenuItem>
                            {ch.doc && (
                              <DropdownMenuItem onSelect={() => changeChapter(ch.id, { doc: undefined })}>
                                <XIcon /> Unlink file
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onSelect={() => removeChapter(ch)}>
                              <Trash2Icon /> Remove chapter
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            {/* Supervisor milestones */}
            <section className="mt-10">
              <h2 className="text-sm font-medium">Supervisor milestones</h2>
              <ul className="mt-2">
                {[...plan.milestones]
                  .sort((a, b) => Number(a.done) - Number(b.done) || (a.due ?? "9999").localeCompare(b.due ?? "9999"))
                  .map((m) => {
                    const overdue = !m.done && !!m.due && m.due < today()
                    return (
                      <li key={m.id} className="group flex items-center gap-3 py-1.5" data-testid="milestone">
                        <Checkbox
                          checked={m.done}
                          aria-label={m.title}
                          onCheckedChange={(v) =>
                            change((p) => ({ ...p, milestones: p.milestones.map((x) => (x.id === m.id ? { ...x, done: v === true } : x)) }))
                          }
                        />
                        <span className={cn("min-w-0 flex-1 truncate text-sm", m.done && "text-muted-foreground line-through")}>{m.title}</span>
                        <DatePick
                          value={m.due}
                          placeholder="Date"
                          overdue={overdue}
                          className={cn(!m.due && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100")}
                          onChange={(due) => change((p) => ({ ...p, milestones: p.milestones.map((x) => (x.id === m.id ? { ...x, due } : x)) }))}
                        />
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label={`Remove ${m.title}`}
                          onClick={() => change((p) => ({ ...p, milestones: p.milestones.filter((x) => x.id !== m.id) }))}
                        >
                          <XIcon />
                        </Button>
                      </li>
                    )
                  })}
              </ul>
              <form onSubmit={addMilestone} className="mt-1 flex items-center gap-3">
                <PlusIcon className="size-4 text-muted-foreground" />
                <Input
                  value={milestone}
                  onChange={(e) => setMilestone(e.target.value)}
                  placeholder="Add a milestone, like “Send chapter 2 draft” or “Ethics approval”"
                  className="h-8 border-none px-0 shadow-none focus-visible:ring-0"
                  aria-label="New milestone"
                />
              </form>
            </section>
          </div>
        </div>
      )}
    </div>
  )
}

function LinkMenu({
  chapter,
  notes,
  texFiles,
  missing,
  onLink,
  onCreate,
}: {
  chapter: Chapter
  notes: NoteFile[]
  texFiles: LatexFile[]
  missing: boolean
  onLink: (doc: Chapter["doc"]) => void
  onCreate: () => void
}) {
  const doc = chapter.doc
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground",
            !doc && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
            missing && "text-destructive",
          )}
        >
          {doc ? (
            <>
              {doc.kind === "note" ? <FileTextIcon className="size-3" /> : <SigmaIcon className="size-3" />}
              <span className="truncate">{missing ? `${doc.path} (missing)` : doc.path.replace(/\.md$/i, "")}</span>
            </>
          ) : (
            <>
              <LinkIcon className="size-3" /> Link a note or LaTeX file
            </>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <DropdownMenuItem onSelect={onCreate}>
          <FilePlusIcon /> New note “{chapter.title}”
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!notes.length}>
            <FileTextIcon /> Existing note
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
            {notes.map((n) => (
              <DropdownMenuItem key={n.path} onSelect={() => onLink({ kind: "note", path: n.path })}>
                <span className="truncate">{n.path.replace(/\.md$/i, "")}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={!texFiles.length}>
            <SigmaIcon /> LaTeX file
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-60 overflow-y-auto">
            {texFiles.length ? (
              texFiles.map((f) => (
                <DropdownMenuItem key={f.path} onSelect={() => onLink({ kind: "latex", path: f.path })}>
                  <span className="truncate">{f.path}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuLabel className="font-normal text-muted-foreground">No LaTeX files yet</DropdownMenuLabel>
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
