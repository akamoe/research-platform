import { useCallback, useEffect, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowUpRightIcon, LoaderCircleIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { api, type KbPage, type PublicSettings, type Source } from "@/lib/api"
import { openSourceAt } from "@/lib/jump"
import { navigate } from "@/lib/router"
import { ModelPicker, rememberModel, savedModel, type ModelChoice } from "@/components/chat/model-picker"
import { sourceType } from "./source-kind"

/**
 * What the source says, at a glance: its page in the knowledge base (summary, key claims,
 * methods, limitations, open questions). The same page chat reads, so there is one summary, not two.
 */
export function SourceSummary({
  projectId,
  source,
  settings,
  onOpenSettings,
}: {
  projectId: string
  source: Source
  settings: PublicSettings
  onOpenSettings: () => void
}) {
  const [page, setPage] = useState<KbPage | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [model, setModel] = useState<ModelChoice | null>(() => savedModel(settings))
  const [pickerOpen, setPickerOpen] = useState(false)
  const anyKey = settings.providers.some((p) => p.configured)

  const load = useCallback(
    () =>
      api.sourceSummary(projectId, source.id).then(
        (r) => {
          setPage(r.page)
          setRunning(r.running)
          setError(r.error)
          setLoaded(true)
        },
        (e) => toast.error(e.message),
      ),
    [projectId, source.id],
  )

  useEffect(() => {
    setLoaded(false)
    setPage(null)
    load()
  }, [load])

  // While the model reads the source, check back every few seconds.
  useEffect(() => {
    if (!running) return
    const t = window.setInterval(load, 3000)
    return () => window.clearInterval(t)
  }, [running, load])

  const summarize = async () => {
    if (!model) return setPickerOpen(true)
    try {
      // The server reads the model from settings, so make sure it has the one shown here.
      await rememberModel(model)
      await api.ingest(projectId, [source.id])
      setRunning(true)
      setError(null)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  if (!loaded) return null

  if (page) {
    const isPdf = sourceType(source) === "pdf"
    // The title is already above; page numbers in a PDF's summary become links to that page.
    let body = page.body.replace(/^#\s+.*\n+/, "")
    if (isPdf) body = body.replace(/\(p\. ?(\d+)\)/g, "[(p. $1)](#page/$1)")
    return (
      <div className="h-full overflow-y-auto">
        <div className="px-8 py-5">
          <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <SparklesIcon className="size-3.5" />
            <span className="truncate">AI reading notes: check them against the source.</span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 text-xs"
              onClick={() => navigate({ name: "project", projectId, view: "knowledge", page: page.id })}
            >
              Knowledge base <ArrowUpRightIcon />
            </Button>
          </div>
          <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-heading prose-h2:mt-5 prose-h2:mb-2 prose-h2:text-sm prose-li:my-0.5">
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => {
                  const pageNo = /^#page\/(\d+)$/.exec(href ?? "")
                  const kb = /^\/?([\w/-]+)\.md$/.exec(href ?? "")
                  const onClick = (e: React.MouseEvent) => {
                    if (pageNo) {
                      e.preventDefault()
                      openSourceAt(projectId, { sourceId: source.id, page: Number(pageNo[1]) })
                    } else if (kb) {
                      e.preventDefault()
                      navigate({ name: "project", projectId, view: "knowledge", page: kb[1] })
                    }
                  }
                  return (
                    <a
                      href={href}
                      onClick={onClick}
                      target={/^https?:/.test(href ?? "") ? "_blank" : undefined}
                      rel="noreferrer"
                      className={pageNo ? "text-muted-foreground no-underline hover:text-foreground hover:underline" : undefined}
                    >
                      {children}
                    </a>
                  )
                },
              }}
            >
              {body}
            </Markdown>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      {running ? (
        <>
          <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Reading “{source.title}”…</p>
        </>
      ) : !source.hasText ? (
        <p className="max-w-xs text-sm text-muted-foreground">No text could be read from this source, so there is nothing to summarize.</p>
      ) : (
        <>
          <p className="max-w-xs text-sm text-muted-foreground">
            A short summary with the key claims, methods, limitations and open questions. It also goes into the knowledge base.
          </p>
          {error && <p className="max-w-xs text-xs text-destructive">Last try failed: {error}</p>}
          {anyKey ? (
            <div className="flex items-center gap-1">
              <ModelPicker settings={settings} value={model} onChange={setModel} open={pickerOpen} onOpenChange={setPickerOpen} />
              <Button size="sm" onClick={summarize}>
                <SparklesIcon /> Summarize
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={onOpenSettings}>
              Add an API key in Settings
            </Button>
          )}
        </>
      )}
    </div>
  )
}
