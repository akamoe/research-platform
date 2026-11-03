import { useEffect, useMemo, useState } from "react"
import { LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { api, type SimilarityMatch, type SimilarityReport } from "@/lib/api"
import { openSourceAt } from "@/lib/jump"
import { cn } from "@/lib/utils"
import type { CheckProps } from "./feedback-panel"

const LABEL: Record<SimilarityMatch["kind"], { label: string; dot: string }> = {
  copied: { label: "Same words", dot: "bg-rose-500" },
  close: { label: "Close to the source", dot: "bg-amber-500" },
  quoted: { label: "Quoted", dot: "bg-emerald-500" },
}

function message(m: SimilarityMatch) {
  if (m.kind === "quoted")
    return m.cited ? "Quoted and cited." : "In quotation marks, but there's no citation. Which source and page is it from?"
  if (m.kind === "copied")
    return m.cited
      ? `Cited, but these are ${m.sourceTitle}'s exact words. Exact words need quotation marks; otherwise, how would you explain the idea yourself?`
      : `These words are the same as in ${m.sourceTitle}, without quotation marks or a citation. Quote and cite them, or explain the idea in your own words.`
  return m.cited
    ? "Cited, but this sentence follows the source's wording and order closely. Could you explain the point your own way?"
    : `This follows ${m.sourceTitle} closely, with a few words changed or moved, and has no citation. Is the idea yours or the source's?`
}

/** Checks a draft against the project's own sources for copied or closely paraphrased passages. */
export function SimilarityCheck({ projectId, file, target, beforeCheck }: Omit<CheckProps, "onClose">) {
  const [report, setReport] = useState<SimilarityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [showQuoted, setShowQuoted] = useState(false)
  const [onlySource, setOnlySource] = useState<string | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const [found, setFound] = useState<Set<string> | null>(null)
  const key = file.notePath ?? file.latexPath ?? ""

  const check = async () => {
    setLoading(true)
    try {
      await beforeCheck?.()
      setReport(await api.similarity(projectId, file))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setReport(null)
    setOnlySource(null)
    check()
    return () => target?.clear()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const flagged = report?.matches.filter((m) => m.kind !== "quoted") ?? []
  const quoted = report?.matches.filter((m) => m.kind === "quoted") ?? []
  const shown = useMemo(
    () => (showQuoted ? quoted : flagged).filter((m) => !onlySource || m.sourceId === onlySource),
    [showQuoted, quoted, flagged, onlySource],
  )
  const activeQuote = shown.find((m) => m.id === active)?.quote

  useEffect(() => {
    if (!target || !report) return
    const t = window.setTimeout(() => setFound(target.mark(shown.map((m) => m.quote), activeQuote)), 50)
    return () => window.clearTimeout(t)
  }, [target, shown, activeQuote, report])

  const pct = report?.words ? Math.round((report.flaggedWords / report.words) * 100) : 0

  return (
    <>
      <div className="space-y-3 border-b p-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            {report ? (
              <>
                <p className="text-sm">
                  <span className="text-2xl font-semibold tabular-nums">{pct}%</span>
                  <span className="ml-1.5 text-muted-foreground">of your words match a source</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {report.flaggedWords} of {report.words} words, not counting quotes
                </p>
              </>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">Comparing with your sources…</p>
            )}
          </div>
          <Button variant="outline" size="icon" className="size-8" disabled={loading} onClick={check} aria-label="Check again">
            {loading ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />}
          </Button>
        </div>
        {!!report?.bySource.length && (
          <ul className="space-y-0.5">
            {report.bySource.map((s) => (
              <li key={s.sourceId}>
                <button
                  type="button"
                  aria-pressed={onlySource === s.sourceId}
                  onClick={() => setOnlySource((o) => (o === s.sourceId ? null : s.sourceId))}
                  className={cn(
                    "flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground",
                    onlySource === s.sourceId && "bg-muted text-foreground",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="tabular-nums">{Math.max(1, Math.round((s.words / report.words) * 100))}%</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {report && (
          <div className="flex gap-1">
            {[false, true].map((q) => (
              <button
                key={String(q)}
                type="button"
                onClick={() => setShowQuoted(q)}
                aria-pressed={showQuoted === q}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
                  showQuoted === q && "border-foreground/30 bg-muted text-foreground",
                )}
              >
                {q ? "Quoted" : "To look at"}
                <span className="tabular-nums">{(q ? quoted : flagged).length}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {report === null ? null : !shown.length ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {showQuoted ? "No quotes from your sources." : "Nothing in this draft repeats your sources word for word or closely."}
          </p>
        ) : (
          <ul className="divide-y">
            {shown.map((m) => {
              const k = LABEL[m.kind]
              const missing = found && !found.has(m.quote)
              return (
                <li
                  key={m.id}
                  className={cn("cursor-pointer px-3 py-3 hover:bg-muted/50", active === m.id && "bg-muted/60")}
                  onMouseEnter={() => setActive(m.id)}
                  onClick={() => {
                    setActive(m.id)
                    target?.reveal(m.quote)
                  }}
                  data-testid="match"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    <span className={cn("size-1.5 rounded-full", k.dot)} />
                    {k.label}
                    <span className="ml-auto font-normal tracking-normal normal-case tabular-nums">{m.words} words</span>
                  </div>
                  <p className={cn("mt-1 line-clamp-3 font-serif text-sm italic", missing && "opacity-60")}>“{m.quote}”</p>
                  <p className="mt-1 text-sm leading-snug text-muted-foreground">{message(m)}</p>
                  <button
                    type="button"
                    className="mt-2 block w-full rounded-md bg-muted/60 px-2.5 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation()
                      openSourceAt(projectId, { sourceId: m.sourceId, page: m.page ?? 1, quote: m.excerpt })
                    }}
                  >
                    <span className="font-medium text-foreground/80">
                      {m.sourceTitle}
                      {m.page ? `, p. ${m.page}` : ""}
                    </span>
                    <span className="mt-0.5 line-clamp-3 block">{m.excerpt}</span>
                  </button>
                  {missing && <p className="mt-1 text-xs text-muted-foreground/70">Changed since the check.</p>}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        Compares your text with the sources in this project, on your computer. It doesn't search the internet.
        {!!report?.unreadable.length && ` Can't compare with ${report.unreadable.join(", ")} (no readable text).`}
      </p>
    </>
  )
}
