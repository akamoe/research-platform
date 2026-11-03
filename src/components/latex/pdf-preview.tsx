import { useEffect, useMemo, useRef, useState } from "react"
import { MinusIcon, PlusIcon } from "lucide-react"
import wasmPath from "@embedpdf/pdfium/pdfium.wasm?url"
import { createPluginRegistration } from "@embedpdf/core"
import { EmbedPDF } from "@embedpdf/core/react"
import { usePdfiumEngine } from "@embedpdf/engines/react"
import { DocumentContent, DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react"
import { Viewport, ViewportPluginPackage } from "@embedpdf/plugin-viewport/react"
import { Scroller, ScrollPluginPackage, useScroll } from "@embedpdf/plugin-scroll/react"
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react"
import { ZoomMode, ZoomPluginPackage, useZoom } from "@embedpdf/plugin-zoom/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const wasmUrl = new URL(wasmPath, window.location.href).href

/** Where the reader was, so a recompiled PDF opens at the same spot and zoom. */
interface View {
  scrollTop: number
  scrollLeft: number
  zoom: number | null
}

/**
 * The compiled PDF. Each new version loads underneath the current one and replaces it once it
 * is ready and scrolled to the same place, so recompiling doesn't flash or jump to page 1.
 */
export function PdfPreview({ url, version }: { url: string; version: number }) {
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl })
  const view = useRef<View>({ scrollTop: 0, scrollLeft: 0, zoom: null })
  const [shown, setShown] = useState(version)
  const [pages, setPages] = useState({ current: 1, total: 0 })
  const versions = shown === version ? [version] : [shown, version]

  if (error) return <Centered>Couldn't start the PDF viewer: {String(error.message ?? error)}</Centered>
  if (isLoading || !engine) return <div className="h-full bg-muted" />

  return (
    <div className="relative h-full min-h-0 bg-muted">
      {versions.map((v) => (
        <div key={v} className={cn("absolute inset-0", v !== shown && "pointer-events-none opacity-0")}>
          <Instance
            engine={engine}
            url={`${url}?v=${v}`}
            id={`latex-${v}`}
            view={view}
            active={v === shown}
            onReady={() => v === version && setShown(v)}
            onPages={setPages}
          />
        </div>
      ))}
      {pages.total > 0 && (
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-md bg-background/90 px-2 py-0.5 text-xs text-muted-foreground tabular-nums shadow-sm">
          {pages.current} / {pages.total}
        </span>
      )}
    </div>
  )
}

function Instance({
  engine,
  url,
  id,
  view,
  active,
  onReady,
  onPages,
}: {
  engine: NonNullable<ReturnType<typeof usePdfiumEngine>["engine"]>
  url: string
  /** Each version needs its own id: the engine is shared, and closing one must not close the other. */
  id: string
  view: React.RefObject<View>
  active: boolean
  onReady: () => void
  onPages: (p: { current: number; total: number }) => void
}) {
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, { initialDocuments: [{ url, documentId: id, mode: "full-fetch" }] }),
      createPluginRegistration(ViewportPluginPackage, { viewportGap: 12 }),
      createPluginRegistration(ScrollPluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
    ],
    [url], // eslint-disable-line react-hooks/exhaustive-deps
  )
  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      {({ activeDocumentId }) =>
        activeDocumentId && (
          <DocumentContent documentId={activeDocumentId}>
            {({ isLoaded }) =>
              isLoaded ? (
                <Pages docId={activeDocumentId} view={view} active={active} onReady={onReady} onPages={onPages} />
              ) : (
                <div className="h-full bg-muted" />
              )
            }
          </DocumentContent>
        )
      }
    </EmbedPDF>
  )
}

function Pages({
  docId,
  view,
  active,
  onReady,
  onPages,
}: {
  docId: string
  view: React.RefObject<View>
  active: boolean
  onReady: () => void
  onPages: (p: { current: number; total: number }) => void
}) {
  const zoom = useZoom(docId)
  const scroll = useScroll(docId)
  const wrap = useRef<HTMLDivElement>(null)
  const scale = zoom.state.currentZoomLevel
  const userZoomed = useRef(false)
  useEffect(() => {
    if (active && userZoomed.current) view.current.zoom = scale
  }, [active, scale, view])

  // Go back to where the reader was, then take over from the old PDF.
  useEffect(() => {
    const el = wrap.current?.firstElementChild as HTMLElement | null
    // A zoom picked with +/- carries over; otherwise the page fits the panel's width.
    const restore = () => {
      if (!el) return
      el.scrollTop = view.current.scrollTop
      el.scrollLeft = view.current.scrollLeft
    }
    const timers = [
      window.setTimeout(() => view.current.zoom && zoom.provides?.requestZoom(view.current.zoom), 40),
      ...[140, 260].map((ms) => window.setTimeout(restore, ms)),
      window.setTimeout(onReady, 320),
    ]
    return () => timers.forEach((t) => window.clearTimeout(t))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The visible copy keeps track of the scroll position and zoom.
  useEffect(() => {
    if (!active) return
    const el = wrap.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const on = () => {
      view.current.scrollTop = el.scrollTop
      view.current.scrollLeft = el.scrollLeft
    }
    el.addEventListener("scroll", on, { passive: true })
    return () => el.removeEventListener("scroll", on)
  }, [active, view])
  useEffect(() => {
    if (active) onPages({ current: scroll.state.currentPage, total: scroll.state.totalPages })
  }, [active, scroll.state.currentPage, scroll.state.totalPages]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full">
      <div ref={wrap} className="absolute inset-0">
        <Viewport documentId={docId} className="absolute inset-0 bg-muted">
          <Scroller
            documentId={docId}
            renderPage={({ pageIndex, width, height }) => (
              <div style={{ width, height }} className="bg-white shadow-sm">
                <RenderLayer documentId={docId} pageIndex={pageIndex} />
              </div>
            )}
          />
        </Viewport>
      </div>
      {active && (
        <div className="absolute right-3 bottom-3 flex items-center rounded-md border bg-background/95 shadow-sm">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => {
              userZoomed.current = true
              zoom.provides?.zoomOut()
            }} aria-label="Zoom out">
            <MinusIcon className="size-3.5" />
          </Button>
          <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => {
              userZoomed.current = true
              zoom.provides?.zoomIn()
            }} aria-label="Zoom in">
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">{children}</div>
}
