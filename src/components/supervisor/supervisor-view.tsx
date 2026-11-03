import { useEffect, useRef, useState } from "react"
import {
  ClipboardCopyIcon,
  ExternalLinkIcon,
  FileSearchIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type SupervisorItem, type SupervisorReview, type SupervisorStatus } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

const when = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "")
const KIND_LABEL: Record<SupervisorItem["type"], string> = {
  comment: "",
  insert: "Suggested edit",
  delete: "Suggested edit",
  replace: "Suggested edit",
  markup: "Marked",
}

interface Props {
  projectId: string
  chatOpen: boolean
  onToggleChat: () => void
}

export function SupervisorView({ projectId, chatOpen, onToggleChat }: Props) {
  const [reviews, setReviews] = useState<SupervisorReview[] | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [filter, setFilter] = useState<"open" | "all">("open")
  const [importing, setImporting] = useState(false)
  const [replying, setReplying] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.supervisor(projectId).then((r) => {
      setReviews(r)
      setCurrent((c) => c ?? r[0]?.id ?? null)
    }, (e) => toast.error(e.message))
  }, [projectId])

  const review = reviews?.find((r) => r.id === current) ?? reviews?.[0]
  const resolved = review?.items.filter((i) => i.status !== "open").length ?? 0
  const shown = review?.items.filter((i) => filter === "all" || i.status === "open") ?? []

  const importFile = async (file: File) => {
    setImporting(true)
    try {
      const r = await api.importSupervisor(projectId, file)
      setReviews((rs) => [r, ...(rs ?? [])])
      setCurrent(r.id)
      setFilter("open")
      toast.success(`${r.items.length} comment${r.items.length === 1 ? "" : "s"} imported from ${r.fileName}`)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const patch = async (item: SupervisorItem, p: { status?: SupervisorStatus; reply?: string }) => {
    if (!review) return
    const rid = review.id
    // Show it at once; the server's copy follows.
    setReviews((rs) => rs?.map((r) => (r.id === rid ? { ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, ...p } : i)) } : r)) ?? rs)
    try {
      const saved = await api.updateSupervisorItem(projectId, rid, item.id, p)
      setReviews((rs) => rs?.map((r) => (r.id === rid ? { ...r, items: r.items.map((i) => (i.id === item.id ? saved : i)) } : r)) ?? rs)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const findInNotes = async (text: string) => {
    try {
      const hits = (await api.search(projectId, text, 10)).filter((h) => h.kind === "note")
      if (!hits.length) return toast("Those words weren't found in your notes. They may have changed since the draft.")
      navigate({ name: "project", projectId, note: hits[0].ref })
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const copyResponses = async () => {
    if (!review) return
    const esc = (s?: string) => (s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ")
    const status = (i: SupervisorItem) => (i.status === "done" ? "Done" : i.status === "declined" ? "Not changed" : "Open")
    const rows = review.items.map(
      (i, n) => `| ${n + 1} | ${esc(i.anchor ? `“${i.anchor}”: ${i.text}` : i.text)} | ${esc(i.reply)} | ${status(i)} |`,
    )
    await navigator.clipboard.writeText(["| # | Comment | Response | Status |", "| --- | --- | --- | --- |", ...rows].join("\n"))
    toast.success("Copied your responses as a table", { description: "Paste it into a note or an email to your supervisor." })
  }

  const remove = async () => {
    if (!review) return
    try {
      await api.removeSupervisor(projectId, review.id)
      setReviews((rs) => rs?.filter((r) => r.id !== review.id) ?? rs)
      setCurrent(null)
      toast("Moved to the trash")
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const rename = async () => {
    if (!review) return
    const title = window.prompt("Name this round of feedback", review.title)?.trim()
    if (!title) return
    try {
      const r = await api.renameSupervisor(projectId, review.id, title)
      setReviews((rs) => rs?.map((x) => (x.id === r.id ? r : x)) ?? rs)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">Supervisor feedback</span>
        <div className="ml-auto flex items-center gap-1">
          <input
            ref={input}
            type="file"
            accept=".docx,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) importFile(f)
            }}
          />
          {!!reviews?.length && (
            <Button variant="outline" size="sm" className="h-8" disabled={importing} onClick={() => input.current?.click()}>
              {importing ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />} Import
            </Button>
          )}
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

      {reviews && !reviews.length ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <div
            className="max-w-md rounded-lg border border-dashed p-8 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files[0]
              if (f) importFile(f)
            }}
          >
            <p className="text-sm text-muted-foreground">
              Import a draft your supervisor commented on, as Word (.docx) or PDF. Each comment and suggested edit becomes a to-do you tick off, with your reply.
            </p>
            <Button className="mt-4" disabled={importing} onClick={() => input.current?.click()}>
              {importing ? <LoaderCircleIcon className="animate-spin" /> : <UploadIcon />} Import file
            </Button>
          </div>
        </div>
      ) : review ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-16">
            <div className="flex items-center gap-2">
              {reviews!.length > 1 ? (
                <Select value={review.id} onValueChange={setCurrent}>
                  <SelectTrigger className="h-8 w-auto max-w-sm border-none px-2 font-medium shadow-none" aria-label="Round of feedback">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {reviews!.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.title} · {when(r.importedAt)} · {r.items.filter((i) => i.status === "open").length} open
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span className="truncate px-2 font-medium">{review.title}</span>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="This round">
                    <MoreHorizontalIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={copyResponses}>
                    <ClipboardCopyIcon /> Copy responses as a table
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={api.supervisorFileUrl(projectId, review.id)} target="_blank" rel="noreferrer">
                      <ExternalLinkIcon /> Open {review.kind === "pdf" ? "the PDF" : "the Word file"}
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={rename}>
                    <PencilIcon /> Rename
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={remove}>
                    <Trash2Icon /> Remove
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={filter}
                onValueChange={(v) => v && setFilter(v as "open" | "all")}
                className="ml-auto"
              >
                <ToggleGroupItem value="open" className="px-3">
                  Open
                </ToggleGroupItem>
                <ToggleGroupItem value="all" className="px-3">
                  All
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="mt-3 flex items-center gap-3 px-2">
              <Progress value={(resolved / Math.max(1, review.items.length)) * 100} aria-label="Comments addressed" />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {resolved} of {review.items.length} done
              </span>
            </div>

            {!shown.length ? (
              <p className="mt-16 text-center text-sm text-muted-foreground">Every comment is dealt with. Nice work.</p>
            ) : (
              <ul className="mt-4 divide-y">
                {shown.map((i) => (
                  <li key={i.id} className="group flex gap-3 px-2 py-4" data-testid="sv-item">
                    <Checkbox
                      className="mt-0.5"
                      checked={i.status === "done"}
                      aria-label={`Done: ${i.text}`}
                      onCheckedChange={(v) => patch(i, { status: v === true ? "done" : "open" })}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        {i.author && <span className="font-medium text-foreground/80">{i.author}</span>}
                        {i.date && <span>{when(i.date)}</span>}
                        {i.page && (
                          <a
                            href={`${api.supervisorFileUrl(projectId, review.id)}#page=${i.page}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-muted px-1 hover:text-foreground"
                          >
                            p. {i.page}
                          </a>
                        )}
                        {KIND_LABEL[i.type] && <Badge variant="outline" className="font-normal">{KIND_LABEL[i.type]}</Badge>}
                        {i.status === "declined" && <Badge variant="secondary" className="font-normal">Won't change</Badge>}
                      </div>
                      {i.anchor && (
                        <p className="mt-1.5 line-clamp-2 border-l-2 pl-2 font-serif text-sm text-muted-foreground italic">{i.anchor}</p>
                      )}
                      <p className={cn("mt-1.5 text-sm whitespace-pre-wrap", i.status !== "open" && "text-muted-foreground")}>{i.text}</p>

                      {replying === i.id ? (
                        <div className="mt-2 space-y-2">
                          <Textarea
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            placeholder="What you changed, or why you kept it"
                            className="min-h-20 text-sm"
                            aria-label="Your reply"
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setReplying(null)
                              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                patch(i, { reply: draft.trim() })
                                setReplying(null)
                              }
                            }}
                          />
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="sm" className="h-7" onClick={() => setReplying(null)}>
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-7"
                              onClick={() => {
                                patch(i, { reply: draft.trim() })
                                setReplying(null)
                              }}
                            >
                              Save reply
                            </Button>
                          </div>
                        </div>
                      ) : i.reply ? (
                        <button
                          type="button"
                          className="mt-2 block w-full rounded-md bg-muted/60 px-3 py-2 text-left text-sm hover:bg-muted"
                          onClick={() => {
                            setDraft(i.reply ?? "")
                            setReplying(i.id)
                          }}
                        >
                          <span className="text-xs text-muted-foreground">Your reply</span>
                          <span className="mt-0.5 block whitespace-pre-wrap">{i.reply}</span>
                        </button>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-start gap-0.5">
                      {!i.reply && replying !== i.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => {
                            setDraft("")
                            setReplying(i.id)
                          }}
                        >
                          Reply
                        </Button>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" aria-label="More">
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {i.anchor && (
                            <DropdownMenuItem onSelect={() => findInNotes(i.anchor!)}>
                              <FileSearchIcon /> Find in my notes
                            </DropdownMenuItem>
                          )}
                          {i.status === "declined" ? (
                            <DropdownMenuItem onSelect={() => patch(i, { status: "open" })}>Reopen</DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              onSelect={() => {
                                patch(i, { status: "declined" })
                                if (!i.reply) {
                                  setDraft("")
                                  setReplying(i.id)
                                }
                              }}
                            >
                              Won't change (say why)
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
