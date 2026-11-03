import { useEffect, useMemo, useRef, useState } from "react"
import { LoaderCircleIcon, RefreshCwIcon, SparklesIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { SimilarityCheck } from "./similarity-check"
import { api, type FeedbackIssue, type FeedbackKind } from "@/lib/api"
import { cn } from "@/lib/utils"

const KINDS: { id: FeedbackKind; label: string; dot: string }[] = [
  { id: "clarity", label: "Clarity", dot: "bg-sky-500" },
  { id: "structure", label: "Structure", dot: "bg-violet-500" },
  { id: "citation", label: "Citations", dot: "bg-amber-500" },
  { id: "grammar", label: "Grammar", dot: "bg-rose-500" },
  { id: "style", label: "Style", dot: "bg-emerald-500" },
]

/** Where the text is shown, so issues can be marked and scrolled to. */
export interface FeedbackTarget {
  /** Mark these quotes (all issues, and the active one). Returns the quotes it could find. */
  mark: (quotes: string[], active?: string) => Set<string>
  /** Scroll to and select a quote. */
  reveal: (quote: string) => void
  clear: () => void
}

const squash = (s: string) => s.replace(/[\s ]+/g, " ").trim()

/** Find words in a rich-text editor's DOM, across text nodes and blocks. */
export function domTarget(getRoot: () => HTMLElement | null): FeedbackTarget {
  const index = () => {
    const root = getRoot()
    if (!root) return null
    let text = ""
    const map: [Text, number][] = []
    let lastBlock: Element | null = null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (n.parentElement?.closest("[contenteditable=false]")) continue
      const block = n.parentElement?.closest("[data-slate-node=element]") ?? null
      if (block !== lastBlock && text && !text.endsWith(" ")) {
        text += " "
        map.push(map[map.length - 1])
      }
      lastBlock = block
      const v = n.data
      for (let i = 0; i < v.length; i++) {
        let ch = v[i]
        if (ch === "﻿") continue
        if (/[\s ]/.test(ch)) {
          if (text.endsWith(" ") || !text) continue
          ch = " "
        }
        text += ch
        map.push([n, i])
      }
    }
    return { text, lower: text.toLowerCase(), map }
  }
  const rangeFor = (idx: NonNullable<ReturnType<typeof index>>, quote: string) => {
    const q = squash(quote)
    let at = idx.text.indexOf(q)
    if (at < 0) at = idx.lower.indexOf(q.toLowerCase())
    let len = q.length
    if (at < 0) {
      // Fall back to the first few words.
      const short = q.split(" ").slice(0, 4).join(" ")
      if (short.length < 8) return null
      at = idx.lower.indexOf(short.toLowerCase())
      len = short.length
    }
    if (at < 0) return null
    const [sn, so] = idx.map[at]
    const [en, eo] = idx.map[at + len - 1]
    const r = document.createRange()
    r.setStart(sn, so)
    r.setEnd(en, eo + 1)
    return r
  }
  const hl = () => (typeof CSS !== "undefined" && "highlights" in CSS ? CSS.highlights : null)
  return {
    mark(quotes, active) {
      const found = new Set<string>()
      const idx = index()
      const reg = hl()
      if (!idx) return found
      const all: Range[] = []
      let act: Range | null = null
      for (const q of quotes) {
        const r = rangeFor(idx, q)
        if (!r) continue
        found.add(q)
        all.push(r)
        if (q === active) act = r
      }
      if (reg) {
        reg.set("rp-issues", new Highlight(...all))
        if (act) reg.set("rp-issue-active", new Highlight(act))
        else reg.delete("rp-issue-active")
      }
      return found
    },
    reveal(quote) {
      const idx = index()
      const r = idx && rangeFor(idx, quote)
      if (!r) return
      const el = r.startContainer.parentElement
      el?.scrollIntoView({ block: "center", behavior: "smooth" })
      hl()?.set("rp-issue-active", new Highlight(r))
    },
    clear() {
      hl()?.delete("rp-issues")
      hl()?.delete("rp-issue-active")
    },
  }
}

export interface CheckProps {
  projectId: string
  /** What to check: a note or a LaTeX file. */
  file: { notePath?: string; latexPath?: string }
  target: FeedbackTarget | null
  /** Wait for unsaved edits to reach the disk before checking. */
  beforeCheck?: () => Promise<unknown>
  onClose: () => void
}

/** The side panel: writing feedback, and the check against the student's own sources. */
export function FeedbackPanel({ onClose, ...props }: CheckProps) {
  const [tab, setTab] = useState<"writing" | "sources">(() => (localStorage.getItem(TAB_KEY) === "sources" ? "sources" : "writing"))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
        <ToggleGroup
          type="single"
          size="sm"
          value={tab}
          onValueChange={(v) => {
            if (!v) return
            setTab(v as typeof tab)
            localStorage.setItem(TAB_KEY, v)
          }}
          aria-label="Check"
        >
          <ToggleGroupItem value="writing" className="h-7 px-2.5 text-sm">
            Writing
          </ToggleGroupItem>
          <ToggleGroupItem value="sources" className="h-7 px-2.5 text-sm">
            Sources
          </ToggleGroupItem>
        </ToggleGroup>
        <Button variant="ghost" size="icon" className="ml-auto size-8 text-muted-foreground" onClick={onClose} aria-label="Close feedback">
          <XIcon className="size-4" />
        </Button>
      </div>
      {tab === "writing" ? <WritingFeedback {...props} /> : <SimilarityCheck {...props} />}
    </div>
  )
}
const TAB_KEY = "rp-feedback-tab"

function WritingFeedback({ projectId, file, target, beforeCheck }: Omit<CheckProps, "onClose">) {
  const [issues, setIssues] = useState<FeedbackIssue[] | null>(null)
  const [loading, setLoading] = useState<"rules" | "ai" | null>(null)
  const [filter, setFilter] = useState<FeedbackKind | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [found, setFound] = useState<Set<string> | null>(null)
  const key = file.notePath ?? file.latexPath ?? ""
  const hadAi = useRef(false)

  const check = async (ai: boolean) => {
    setLoading(ai ? "ai" : "rules")
    try {
      await beforeCheck?.()
      const res = await api.feedback(projectId, file, ai)
      // Keep an earlier AI review when only the quick checks are re-run.
      setIssues((prev) => (ai || !hadAi.current ? res.issues : [...(prev ?? []).filter((i) => i.by === "ai"), ...res.issues]))
      if (ai) hadAi.current = true
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(null)
    }
  }

  useEffect(() => {
    hadAi.current = false
    setIssues(null)
    setDismissed(new Set())
    check(false)
    return () => target?.clear()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(
    () => (issues ?? []).filter((i) => !dismissed.has(i.id) && (!filter || i.kind === filter)),
    [issues, dismissed, filter],
  )
  const activeQuote = shown.find((i) => i.id === active)?.quote

  // Mark the issues in the text; ranges follow edits, so re-mark only when the list changes.
  useEffect(() => {
    if (!target || !issues) return
    const t = window.setTimeout(() => setFound(target.mark(shown.map((i) => i.quote), activeQuote)), 50)
    return () => window.clearTimeout(t)
  }, [target, shown, activeQuote, issues])
  useEffect(() => () => target?.clear(), [target])

  const counts = Object.fromEntries(KINDS.map((k) => [k.id, (issues ?? []).filter((i) => i.kind === k.id && !dismissed.has(i.id)).length]))

  return (
    <>
      <div className="space-y-3 border-b p-3">
        <div className="flex gap-2">
          <Button size="sm" className="h-8 flex-1" disabled={!!loading} onClick={() => check(true)}>
            {loading === "ai" ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
            {loading === "ai" ? "Reading your draft…" : hadAi.current ? "Review again with AI" : "Review with AI"}
          </Button>
          <Button variant="outline" size="icon" className="size-8" disabled={!!loading} onClick={() => check(false)} aria-label="Check again">
            {loading === "rules" ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => setFilter((f) => (f === k.id ? null : k.id))}
              aria-pressed={filter === k.id}
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
                filter === k.id && "border-foreground/30 bg-muted text-foreground",
                !counts[k.id] && "opacity-50",
              )}
            >
              <span className={cn("size-1.5 rounded-full", k.dot)} />
              {k.label}
              <span className="tabular-nums">{counts[k.id]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {issues === null ? null : !shown.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {issues.length ? "Nothing left in this filter." : hadAi.current ? "No issues found." : "The quick checks found nothing. Ask the AI for a closer review."}
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((i) => {
              const k = KINDS.find((x) => x.id === i.kind)!
              const missing = found && !found.has(i.quote)
              return (
                <li
                  key={i.id}
                  className={cn("group relative cursor-pointer px-3 py-3 hover:bg-muted/50", active === i.id && "bg-muted/60")}
                  onMouseEnter={() => setActive(i.id)}
                  onClick={() => {
                    setActive(i.id)
                    target?.reveal(i.quote)
                  }}
                  data-testid="issue"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <span className={cn("size-1.5 rounded-full", k.dot)} />
                    {k.label}
                    {i.by === "ai" && <SparklesIcon className="size-3" aria-label="From the AI review" />}
                  </div>
                  <p className={cn("mt-1 line-clamp-2 font-serif text-sm italic", missing && "opacity-60")}>“{i.quote}”</p>
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">{i.message}</p>
                  {missing && <p className="mt-1 text-xs text-muted-foreground/70">Changed since the check.</p>}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 size-6 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label="Dismiss"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDismissed((d) => new Set(d).add(i.id))
                    }}
                  >
                    <XIcon />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">Feedback points at problems and asks questions. It never rewrites your text.</p>
    </>
  )
}
