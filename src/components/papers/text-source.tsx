import { useEffect, useRef, useState } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ExternalLinkIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { api, type Source } from "@/lib/api"
import { takePendingPage, type PageTarget } from "@/lib/jump"
import { SourceIcon, sourceKind, sourceType } from "./source-kind"

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()

function youtubeId(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.searchParams.get("v") ?? (u.hostname === "youtu.be" ? u.pathname.slice(1) : null)
  } catch {
    return null
  }
}

const STAMP = /^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*/

const seconds = (stamp: string) => stamp.split(":").reduce((a, n) => a * 60 + Number(n), 0)

/**
 * The reader for sources that are text: web pages, video transcripts, Word files and pasted text.
 * Plain selection and copy work as usual; search and chat citations scroll to the passage.
 */
export function TextSource({ projectId, source }: { projectId: string; source: Source }) {
  const [text, setText] = useState<string | null>(null)
  const body = useRef<HTMLDivElement>(null)
  const player = useRef<HTMLIFrameElement>(null)
  const video = sourceType(source) === "youtube" ? youtubeId(source.url) : null

  useEffect(() => {
    api.sourceText(projectId, source.id).then(
      (r) => setText(r.text),
      (e) => toast.error(e.message),
    )
  }, [projectId, source.id])

  // Scroll to a passage when opened from search or a chat citation.
  useEffect(() => {
    if (text === null) return
    const show = (t: PageTarget) => {
      if (!t.quote || !body.current) return
      const words = norm(t.quote.replace(/«|»|…/g, "")).split(" ")
      const blocks = Array.from(body.current.querySelectorAll<HTMLElement>("p, li, h2, h3, h4, blockquote, pre"))
      for (const n of [8, 4]) {
        const key = words.slice(0, n).join(" ")
        if (!key) return
        const el = blocks.find((b) => norm(b.textContent ?? "").includes(key))
        if (el) {
          el.scrollIntoView({ block: "center", behavior: "smooth" })
          el.classList.add("rp-flash")
          window.setTimeout(() => el.classList.remove("rp-flash"), 1800)
          return
        }
      }
    }
    const first = takePendingPage(source.id)
    const timer = first ? window.setTimeout(() => show(first), 80) : undefined
    const on = (e: Event) => {
      const t = (e as CustomEvent<PageTarget>).detail
      if (t.sourceId !== source.id) return
      takePendingPage(source.id)
      show(t)
    }
    window.addEventListener("rp:goto-page", on)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("rp:goto-page", on)
    }
  }, [text, source.id])

  const seek = (sec: number) =>
    player.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "seekTo", args: [sec, true] }), "*")

  const kind = sourceKind(source)
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-[37px] shrink-0 items-center gap-2 border-b px-3 text-xs text-muted-foreground">
        <SourceIcon source={source} className="size-3.5" />
        <span className="truncate">
          {kind.label}
          {source.author && ` · ${source.author}`}
          {source.url && ` · ${new URL(source.url).hostname.replace(/^www\./, "")}`}
        </span>
        {source.url && (
          <Button variant="ghost" size="sm" className="ml-auto h-7 text-xs" asChild>
            <a href={source.url} target="_blank" rel="noreferrer">
              <ExternalLinkIcon /> Open original
            </a>
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {video && (
          <div className="border-b bg-black">
            <iframe
              ref={player}
              src={`https://www.youtube-nocookie.com/embed/${video}?enablejsapi=1&rel=0`}
              title={source.title}
              className="mx-auto aspect-video w-full max-w-3xl"
              allow="encrypted-media; picture-in-picture; fullscreen"
            />
          </div>
        )}
        <div
          ref={body}
          className="prose prose-sm mx-auto max-w-2xl px-8 py-6 dark:prose-invert prose-headings:font-semibold prose-p:leading-relaxed"
        >
          {text === null ? null : (
            <Markdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
                // Transcript paragraphs start with [m:ss]; make that a button that jumps the video.
                p: ({ children }) => {
                  const first = Array.isArray(children) ? children[0] : children
                  const m = typeof first === "string" ? first.match(STAMP) : null
                  if (!m) return <p>{children}</p>
                  const rest = Array.isArray(children) ? [first.slice(m[0].length), ...children.slice(1)] : first.slice(m[0].length)
                  return (
                    <p>
                      <button
                        onClick={() => seek(seconds(m[1]))}
                        disabled={!video}
                        className="mr-2 rounded-sm bg-muted px-1 font-mono text-[0.8em] text-muted-foreground tabular-nums hover:bg-accent hover:text-foreground"
                        title={video ? "Play from here" : undefined}
                      >
                        {m[1]}
                      </button>
                      {rest}
                    </p>
                  )
                },
              }}
            >
              {text}
            </Markdown>
          )}
        </div>
      </div>
    </div>
  )
}
