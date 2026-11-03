import { useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  CheckIcon,
  ExternalLinkIcon,
  FileDownIcon,
  LoaderCircleIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  QuoteIcon,
  SearchIcon,
  SlidersHorizontalIcon,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type DiscoverProvider, type Reference, type Source, type Work } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

const PROVIDERS: { id: DiscoverProvider | "all"; name: string }[] = [
  { id: "all", name: "All sources" },
  { id: "openalex", name: "OpenAlex" },
  { id: "s2", name: "Semantic Scholar" },
  { id: "arxiv", name: "arXiv" },
  { id: "crossref", name: "Crossref" },
]
const SHORT: Record<DiscoverProvider, string> = { openalex: "OpenAlex", s2: "Semantic Scholar", arxiv: "arXiv", crossref: "Crossref" }

type Relation = "related" | "citing" | "references"
const RELATION_LABEL: Record<Relation, string> = { related: "Related to", citing: "Papers citing", references: "Cited by" }

interface Page {
  label?: string
  works: Work[]
  failed?: string[]
}

const normDoi = (d?: string) => d?.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim()
const normTitle = (t?: string) => (t ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim()

function authorLine(a: string[]) {
  if (!a.length) return ""
  if (a.length <= 3) return a.join(", ")
  return `${a.slice(0, 2).join(", ")} et al.`
}

interface Props {
  projectId: string
  papers: Source[]
  /** A DOI to start from: shows papers related to it. */
  seed?: string
  chatOpen: boolean
  onToggleChat: () => void
  onAdded: (source: Source) => void
}

export function DiscoverView({ projectId, seed, chatOpen, onToggleChat, onAdded }: Props) {
  const [q, setQ] = useState("")
  const [provider, setProvider] = useState<DiscoverProvider | "all">("all")
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [oa, setOa] = useState(false)
  const [stack, setStack] = useState<Page[]>([])
  const [loading, setLoading] = useState(false)
  const [refs, setRefs] = useState<Reference[]>([])
  const [adding, setAdding] = useState<Record<string, "ref" | "pdf">>({})
  const [open, setOpen] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const page = stack[stack.length - 1]

  useEffect(() => {
    api.references(projectId).then(setRefs, () => {})
    input.current?.focus()
  }, [projectId])

  useEffect(() => {
    if (!seed) return
    const doi = normDoi(seed)!
    explore({ key: `doi:${doi}`, title: doi, authors: [], doi, from: [] }, "related", true)
  }, [seed]) // eslint-disable-line react-hooks/exhaustive-deps

  const inLibrary = (w: Work) =>
    refs.some((r) => (w.doi && normDoi(r.DOI) === w.doi) || (normTitle(r.title) && normTitle(r.title) === normTitle(w.title)))

  const run = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!q.trim()) return
    setLoading(true)
    setOpen(null)
    try {
      const res = await api.discoverSearch(q.trim(), { provider, from, to, oa })
      setStack([{ works: res.works, failed: res.failed }])
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const explore = async (w: Work, rel: Relation, fresh = false) => {
    setLoading(true)
    setOpen(null)
    try {
      const res = await api.discoverAround(w, rel)
      const label = `${RELATION_LABEL[rel]} “${w.title}”`
      setStack((s) => [...(fresh ? [] : s), { label, works: res.works }])
      if (!res.works.length) toast("Nothing found for that paper.")
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const add = async (w: Work, withPdf: boolean) => {
    setAdding((a) => ({ ...a, [w.key]: withPdf ? "pdf" : "ref" }))
    try {
      const res = await api.discoverAdd(projectId, w, withPdf)
      setRefs((rs) => (rs.some((r) => r.id === res.reference.id) ? rs : [...rs, res.reference]))
      if (res.source) onAdded(res.source)
      const key = res.reference.id
      if (res.pdfError) toast.warning(res.pdfError)
      else if (res.source)
        toast.success(res.alreadyHad ? "Already in your sources" : "Added to Sources and References", {
          description: `Cite it as [@${key}]`,
          action: { label: "Open", onClick: () => navigate({ name: "project", projectId, paper: res.source!.id }) },
        })
      else toast.success(res.alreadyHad ? "Already in your references" : "Added to References", { description: `Cite it as [@${key}]` })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setAdding(({ [w.key]: _, ...a }) => a)
    }
  }

  const filters = [from || to ? 1 : 0, oa ? 1 : 0].reduce((a, b) => a + b, 0)

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <SidebarTrigger className="text-muted-foreground" />
        <span className="text-sm font-medium">Find papers</span>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 pb-16">
          <form onSubmit={run} className="flex items-center gap-2 pt-2">
            <div className="relative flex-1">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by topic, title, author or DOI"
                className="pl-8"
                aria-label="Search for papers"
              />
            </div>
            <Select value={provider} onValueChange={(v) => setProvider(v as DiscoverProvider | "all")}>
              <SelectTrigger className="w-40" aria-label="Where to search">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="icon" className="relative" aria-label="Filters">
                  <SlidersHorizontalIcon />
                  {filters > 0 && (
                    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">
                      {filters}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Published</Label>
                  <div className="flex items-center gap-2">
                    <Input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="From" aria-label="From year" />
                    <span className="text-muted-foreground">–</span>
                    <Input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="To" aria-label="To year" />
                  </div>
                </div>
                <Label className="flex items-center gap-2 font-normal">
                  <Checkbox checked={oa} onCheckedChange={(v) => setOa(v === true)} />
                  Only papers with a free PDF
                </Label>
              </PopoverContent>
            </Popover>
            <Button type="submit" disabled={!q.trim() || loading}>
              {loading && !page ? <LoaderCircleIcon className="animate-spin" /> : null}
              Search
            </Button>
          </form>

          {stack.length > 1 || page?.label ? (
            <div className="mt-4 flex min-w-0 items-center gap-2 text-sm">
              {stack.length > 1 && (
                <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => setStack((s) => s.slice(0, -1))} aria-label="Back">
                  <ArrowLeftIcon />
                </Button>
              )}
              <span className="truncate text-muted-foreground">{page?.label}</span>
            </div>
          ) : null}

          {page?.failed?.length ? (
            <p className="mt-3 text-xs text-muted-foreground">{page.failed.join(" and ")} didn't answer, so these results come from the others.</p>
          ) : null}

          {loading ? (
            <div className="mt-6 space-y-6">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : !page ? (
            <div className="mt-24 text-center text-sm text-muted-foreground">
              <p>Search OpenAlex, Semantic Scholar, arXiv and Crossref in one place.</p>
              <p className="mt-1">Add a paper to your references, with its PDF when a free copy exists.</p>
            </div>
          ) : !page.works.length ? (
            <p className="mt-24 text-center text-sm text-muted-foreground">No papers found. Try fewer or different words.</p>
          ) : (
            <ul className="mt-4 divide-y">
              {page.works.map((w) => {
                const had = inLibrary(w)
                const busy = adding[w.key]
                const free = !!(w.pdfUrl || w.arxivId)
                return (
                  <li key={w.key} className="group py-4" data-testid="work">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          className="text-left leading-snug font-medium hover:underline"
                          onClick={() => setOpen((o) => (o === w.key ? null : w.key))}
                          aria-expanded={open === w.key}
                        >
                          {w.title}
                        </button>
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          {[authorLine(w.authors), w.year, w.venue].filter(Boolean).join(" · ")}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                          {w.citedBy ? <span>Cited by {w.citedBy.toLocaleString()}</span> : null}
                          {free && (
                            <Badge variant="outline" className="font-normal">
                              Free PDF
                            </Badge>
                          )}
                          {had && (
                            <Badge variant="secondary" className="font-normal">
                              <CheckIcon /> In references
                            </Badge>
                          )}
                          <span className="opacity-0 transition-opacity group-hover:opacity-100">{w.from.map((p) => SHORT[p]).join(", ")}</span>
                        </div>
                        {open === w.key && (
                          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{w.abstract ?? "No abstract available."}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {!(had && !free) && (
                          <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => add(w, free)}>
                            {busy ? <LoaderCircleIcon className="animate-spin" /> : free ? <FileDownIcon /> : <QuoteIcon />}
                            {had ? "Add PDF" : free ? "Add with PDF" : "Add"}
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="More">
                              <MoreHorizontalIcon />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem onSelect={() => explore(w, "related")}>Related papers</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => explore(w, "citing")}>Papers citing this</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => explore(w, "references")}>Its references</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {free ? (
                              <DropdownMenuItem onSelect={() => add(w, false)}>Add reference only</DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onSelect={() => add(w, true)}>Look for a free PDF</DropdownMenuItem>
                            )}
                            {w.url && (
                              <DropdownMenuItem asChild>
                                <a href={w.url} target="_blank" rel="noreferrer">
                                  Open paper's page <ExternalLinkIcon className="ml-auto" />
                                </a>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
