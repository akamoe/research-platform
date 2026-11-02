import { useCallback, useEffect, useMemo, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  BookOpenIcon,
  CheckIcon,
  CodeIcon,
  HistoryIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  ScanSearchIcon,
  SparklesIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type KbFinding, type KbOverview, type KbPage, type KbPageMeta } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

interface Props {
  projectId: string
  page?: string
  chatOpen: boolean
  onToggleChat: () => void
}

const LOG = "log"

export function KnowledgeView({ projectId, page, chatOpen, onToggleChat }: Props) {
  const [data, setData] = useState<KbOverview | null>(null)
  const [checking, setChecking] = useState(false)
  const go = useCallback((p?: string) => navigate({ name: "project", projectId, view: "knowledge", page: p }), [projectId])

  const refresh = useCallback(() => api.knowledge(projectId).then(setData, (e) => toast.error(e.message)), [projectId])
  useEffect(() => {
    refresh()
  }, [refresh])

  // While papers are being read, check back every few seconds.
  const running = data?.status.running.length ?? 0
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(refresh, 3000)
    return () => window.clearInterval(t)
  }, [running, refresh])

  const ingest = async (ids?: string[]) => {
    try {
      const status = await api.ingest(projectId, ids)
      setData((d) => (d ? { ...d, status } : d))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const check = async () => {
    setChecking(true)
    try {
      const lint = await api.lintKnowledge(projectId)
      setData((d) => (d ? { ...d, lint } : d))
      go(undefined)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setChecking(false)
    }
  }

  const groups = useMemo(() => {
    const m = new Map<string, KbPageMeta[]>()
    for (const p of data?.pages ?? []) m.set(p.type, [...(m.get(p.type) ?? []), p])
    return [...m.entries()].sort(([a], [b]) => (a === "Paper" ? -1 : b === "Paper" ? 1 : a.localeCompare(b)))
  }, [data])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <button className="text-sm font-medium" onClick={() => go(undefined)}>
          Knowledge base
        </button>
        {running > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <LoaderCircleIcon className="size-3.5 animate-spin" /> Reading {running} paper{running > 1 ? "s" : ""}…
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-muted-foreground" onClick={check} disabled={checking || !data?.pages.length}>
                {checking ? <LoaderCircleIcon className="size-4 animate-spin" /> : <ScanSearchIcon className="size-4" />}
                Check
              </Button>
            </TooltipTrigger>
            <TooltipContent>Look for contradictions, gaps and broken links</TooltipContent>
          </Tooltip>
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
            <TooltipContent>Chat (Ctrl/⌘ J). It reads this knowledge base.</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 border-t">
        <div className="w-60 shrink-0 overflow-y-auto border-r max-md:hidden">
          <nav className="flex flex-col gap-4 p-2 text-sm">
            <div className="flex flex-col">
              <NavItem active={!page} onClick={() => go(undefined)}>
                <SparklesIcon className="size-3.5" /> Overview
              </NavItem>
              <NavItem active={page === LOG} onClick={() => go(LOG)}>
                <HistoryIcon className="size-3.5" /> History
              </NavItem>
            </div>
            {groups.map(([type, pages]) => (
              <div key={type} className="flex flex-col">
                <div className="px-2 pb-1 text-xs text-muted-foreground">{plural(type)}</div>
                {pages.map((p) => (
                  <NavItem key={p.id} active={page === p.id} onClick={() => go(p.id)} title={p.description}>
                    <span className="truncate">{p.title}</span>
                    {p.contested && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-destructive" title="Has tensions" />}
                  </NavItem>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <ScrollArea className="min-w-0 flex-1">
          <div className="mx-auto max-w-[720px] px-8 py-6 sm:px-12">
            {!data ? null : page === LOG ? (
              <LogView projectId={projectId} onLink={go} />
            ) : page ? (
              <PageView key={page} projectId={projectId} pageId={page} onLink={go} onSaved={refresh} />
            ) : (
              <Overview data={data} checking={checking} onIngest={ingest} onOpen={go} />
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

function NavItem({ active, children, ...rest }: React.ComponentProps<"button"> & { active?: boolean }) {
  return (
    <button
      {...rest}
      className={cn(
        "flex h-8 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted",
        active && "bg-muted font-medium",
      )}
    >
      {children}
    </button>
  )
}

const plural = (t: string) => (/[sxz]$/.test(t) ? `${t}es` : /y$/.test(t) ? `${t.slice(0, -1)}ies` : `${t}s`)

const KIND_LABEL: Record<KbFinding["kind"], string> = {
  contradiction: "Contradiction",
  gap: "Gap",
  duplicate: "Duplicate",
  unsupported: "Unsupported",
  "broken-link": "Broken link",
  orphan: "Not linked",
  question: "Question",
}

function Overview({
  data,
  checking,
  onIngest,
  onOpen,
}: {
  data: KbOverview
  checking: boolean
  onIngest: (ids?: string[]) => void
  onOpen: (page: string) => void
}) {
  const { status, lint, pages } = data
  const waiting = status.notIngested.filter((s) => !s.running)
  const titleOf = (id: string) => pages.find((p) => p.id === id)?.title ?? id
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Knowledge base</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The AI's memory of this project. Each paper you add is read once and filed into short, linked pages, so the chat
          can build on what you've read. It's AI-made notes, not your writing: check pages against the papers and mark them
          reviewed.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {pages.length} page{pages.length === 1 ? "" : "s"} · plain markdown files in Open Knowledge Format, in the project's
          knowledge folder
        </p>
      </div>

      {(waiting.length > 0 || status.running.length > 0) && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Papers not in the knowledge base yet</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {status.notIngested.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                {s.running ? (
                  <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <BookOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{s.title}</span>
                {s.running && <span className="text-xs text-muted-foreground">reading…</span>}
                {s.error && !s.running && (
                  <span className="truncate text-xs text-destructive" title={s.error}>
                    {s.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {waiting.length > 0 && (
            <Button size="sm" variant="outline" className="w-fit" onClick={() => onIngest(waiting.map((s) => s.id))}>
              Add {waiting.length === 1 ? "it" : `all ${waiting.length}`}
            </Button>
          )}
        </section>
      )}

      {pages.length === 0 && status.notIngested.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing here yet. Add a PDF to the project and it will be read into pages.</p>
      )}

      {pages.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-medium">Last check</h2>
            {lint && <span className="text-xs text-muted-foreground">{new Date(lint.at).toLocaleString()}</span>}
          </div>
          {checking ? (
            <p className="text-sm text-muted-foreground">Reading every page…</p>
          ) : !lint ? (
            <p className="text-sm text-muted-foreground">
              Not checked yet. <span className="font-medium text-foreground">Check</span> looks for contradictions between
              papers, gaps and broken links.
            </p>
          ) : lint.findings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing to flag.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {lint.findings.map((f, i) => (
                <li key={i} className="flex flex-col gap-1.5 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={f.kind === "contradiction" ? "destructive" : "secondary"}>{KIND_LABEL[f.kind]}</Badge>
                    {f.pages.map((p) => (
                      <button key={p} className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => onOpen(p)}>
                        {titleOf(p)}
                      </button>
                    ))}
                  </div>
                  <p className="text-sm">{f.message}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

/** Links inside pages: `/concepts/x.md` opens that page, `../sources/<id>.pdf` opens the paper. */
function useLinkHandler(projectId: string, onLink: (page: string) => void) {
  return (href: string | undefined) => (e: React.MouseEvent) => {
    if (!href) return
    const page = /^\/?([\w/-]+)\.md$/.exec(href)
    const pdf = /sources\/([\w-]+)\.pdf$/.exec(href)
    if (page) {
      e.preventDefault()
      onLink(page[1])
    } else if (pdf) {
      e.preventDefault()
      navigate({ name: "project", projectId, paper: pdf[1] })
    }
  }
}

function MarkdownBody({ text, projectId, onLink }: { text: string; projectId: string; onLink: (page: string) => void }) {
  const onClick = useLinkHandler(projectId, onLink)
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-heading prose-h1:text-2xl prose-h2:mt-6 prose-h2:text-base prose-h3:text-sm prose-li:my-0.5">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} onClick={onClick(href)} target={/^https?:/.test(href ?? "") ? "_blank" : undefined} rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}

function PageView({
  projectId,
  pageId,
  onLink,
  onSaved,
}: {
  projectId: string
  pageId: string
  onLink: (page: string) => void
  onSaved: () => void
}) {
  const [page, setPage] = useState<KbPage | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const onClick = useLinkHandler(projectId, onLink)

  useEffect(() => {
    api.kbPage(projectId, pageId).then(setPage, (e) => toast.error(e.message))
  }, [projectId, pageId])

  if (!page) return null
  const reviewed = page.verified?.some((v) => v.by.startsWith("human:"))
  const byHuman = page.generated?.by.startsWith("human:")

  const save = async () => {
    try {
      setPage(await api.saveKbPage(projectId, pageId, draft ?? page.raw))
      setDraft(null)
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  const review = async () => {
    try {
      setPage(await api.reviewKbPage(projectId, pageId))
      onSaved()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">{page.type}</Badge>
        {page.contested && <Badge variant="destructive">Has tensions</Badge>}
        {reviewed ? (
          <span className="flex items-center gap-1">
            <CheckIcon className="size-3.5" /> Reviewed by you
          </span>
        ) : (
          <span>{byHuman ? "Edited by you" : "AI notes, not reviewed yet"}</span>
        )}
        {page.tags.map((t) => (
          <span key={t} className="rounded bg-muted px-1.5 py-0.5">
            {t}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {!reviewed && draft === null && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground" onClick={review}>
                  <CheckIcon className="size-3.5" /> Mark reviewed
                </Button>
              </TooltipTrigger>
              <TooltipContent>You checked this page against its papers</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={cn("size-7 text-muted-foreground", draft !== null && "bg-muted text-foreground")}
                onClick={() => setDraft((d) => (d === null ? page.raw : null))}
              >
                <CodeIcon className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{draft === null ? "Edit the page" : "Cancel editing"}</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[60vh] font-mono text-[13px] leading-relaxed"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <MarkdownBody text={page.body} projectId={projectId} onLink={onLink} />
      )}

      {page.sources.length > 0 && draft === null && (
        <div className="border-t pt-3 text-xs text-muted-foreground">
          From:{" "}
          {page.sources.map((s, i) => (
            <span key={s.resource}>
              {i > 0 && ", "}
              <a href={s.resource} onClick={onClick(s.resource)} className="underline-offset-2 hover:underline">
                {s.title ?? s.resource}
              </a>
            </span>
          ))}
          {page.generated && <span> · written by {page.generated.by.replace(/^(research-platform|folio)\//, "")}</span>}
        </div>
      )}
    </div>
  )
}

function LogView({ projectId, onLink }: { projectId: string; onLink: (page: string) => void }) {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    api.kbLog(projectId).then((r) => setText(r.content), () => setText(""))
  }, [projectId])
  return text === null ? null : <MarkdownBody text={text} projectId={projectId} onLink={onLink} />
}
