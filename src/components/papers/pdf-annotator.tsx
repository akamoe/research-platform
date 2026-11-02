import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ClipboardCopyIcon, CopyIcon, MinusIcon, NotebookPenIcon, PlusIcon, ScanIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import wasmPath from "@embedpdf/pdfium/pdfium.wasm?url"
import { createPluginRegistration } from "@embedpdf/core"
import { EmbedPDF } from "@embedpdf/core/react"
import { usePdfiumEngine } from "@embedpdf/engines/react"
import { DocumentContent, DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react"
import { Viewport, ViewportPluginPackage } from "@embedpdf/plugin-viewport/react"
import { Scroller, ScrollPluginPackage, useScroll } from "@embedpdf/plugin-scroll/react"
import { RenderLayer, RenderPluginPackage } from "@embedpdf/plugin-render/react"
import { ZoomMode, ZoomPluginPackage, useZoom } from "@embedpdf/plugin-zoom/react"
import { InteractionManagerPluginPackage, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react"
import {
  SelectionLayer,
  SelectionPluginPackage,
  useSelectionCapability,
  type SelectionSelectionMenuProps,
} from "@embedpdf/plugin-selection/react"
import { CapturePluginPackage, MarqueeCapture, useCapture } from "@embedpdf/plugin-capture/react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type Highlight, type HighlightColor, type PdfRect, type Source } from "@/lib/api"
import { cn } from "@/lib/utils"

const COLORS: { id: HighlightColor; fill: string; dot: string; emoji: string }[] = [
  { id: "yellow", fill: "rgba(250, 204, 21, 0.38)", dot: "#facc15", emoji: "🟡" },
  { id: "green", fill: "rgba(74, 222, 128, 0.35)", dot: "#4ade80", emoji: "🟢" },
  { id: "blue", fill: "rgba(96, 165, 250, 0.35)", dot: "#60a5fa", emoji: "🔵" },
  { id: "red", fill: "rgba(248, 113, 113, 0.35)", dot: "#f87171", emoji: "🔴" },
  { id: "purple", fill: "rgba(192, 132, 252, 0.35)", dot: "#c084fc", emoji: "🟣" },
]
// The engine runs in a blob: worker, where a root-relative URL can't be resolved.
const wasmUrl = new URL(wasmPath, window.location.href).href

const colorOf = (id: HighlightColor) => COLORS.find((c) => c.id === id) ?? COLORS[0]

/** Selected PDF text often has hard line breaks and hyphenated words; tidy it for the note. */
function tidy(lines: string[]) {
  return lines
    .join("\n")
    .replace(/-\n(?=\w)/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
}

function quoteMarkdown(source: Source, h: Highlight) {
  const link = `[${colorOf(h.color).emoji} p. ${h.pageIndex + 1}](#hl/${source.id}/${h.id})`
  const text = (h.text ?? "").replace(/([\\`*_[\]<>])/g, "\\$1")
  return `> ${text} ${link}`
}

function figureMarkdown(projectId: string, source: Source, h: Highlight) {
  const url = api.assetUrl(projectId, source.id, h.image!)
  return `![Figure, p. ${h.pageIndex + 1}](${url} "hl/${source.id}/${h.id}")`
}

/** What a new highlight or capture does: copy it, or put it straight into the note. */
type Mode = "copy" | "note"

/**
 * Copies a highlight for pasting into the note. The clipboard write starts inside the
 * click (Safari requires that), with the content filled in once the highlight is saved.
 * The note recognises the pasted markdown; other apps get the plain text or the image.
 */
async function copyHighlight(markdown: Promise<string>, image?: Blob | Promise<Blob>) {
  try {
    const items: Record<string, Promise<Blob> | Blob> = {
      "text/plain": markdown.then((md) => new Blob([md], { type: "text/plain" })),
    }
    if (image) items["image/png"] = image
    await navigator.clipboard.write([new ClipboardItem(items)])
    toast.success(image ? "Image copied. Paste it into your note." : "Copied. Paste it into your note.")
  } catch {
    // The browser refused (often because the click was too long ago); a fresh click works.
    const md = await markdown.catch(() => null)
    if (md === null) return
    toast("Ready to copy", { action: { label: "Copy", onClick: () => void navigator.clipboard.writeText(md) } })
  }
}

interface Props {
  projectId: string
  source: Source
  /** Puts markdown into the paper's note, next to the PDF. */
  onInsert: (markdown: string) => void
}

export function PdfAnnotator({ projectId, source, onInsert }: Props) {
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl })
  const plugins = useMemo(
    () => [
      createPluginRegistration(DocumentManagerPluginPackage, {
        initialDocuments: [{ url: api.pdfUrl(projectId, source.id) }],
      }),
      createPluginRegistration(ViewportPluginPackage, { viewportGap: 16 }),
      createPluginRegistration(ScrollPluginPackage),
      createPluginRegistration(RenderPluginPackage),
      createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage),
      createPluginRegistration(CapturePluginPackage, { scale: 2, imageType: "image/png" }),
    ],
    [projectId, source.id],
  )

  if (error) return <Centered>Couldn't start the PDF viewer: {String(error.message ?? error)}</Centered>
  if (isLoading || !engine) return <Centered>Opening PDF…</Centered>

  return (
    <EmbedPDF engine={engine} plugins={plugins}>
      {({ activeDocumentId }) =>
        activeDocumentId && (
          <DocumentContent documentId={activeDocumentId}>
            {({ isLoaded }) =>
              isLoaded ? (
                <Annotator docId={activeDocumentId} projectId={projectId} source={source} onInsert={onInsert} />
              ) : (
                <Centered>Opening PDF…</Centered>
              )
            }
          </DocumentContent>
        )
      }
    </EmbedPDF>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center bg-muted text-sm text-muted-foreground">{children}</div>
}

function Annotator({ docId, projectId, source, onInsert }: Props & { docId: string }) {
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [color, setColorState] = useState<HighlightColor>(
    () => (localStorage.getItem("rp-hl-color") as HighlightColor) || "yellow",
  )
  const [mode, setModeState] = useState<Mode>(() => (localStorage.getItem("rp-hl-mode") as Mode) || "copy")
  const [active, setActive] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const zoom = useZoom(docId)
  const scale = zoom.state.currentZoomLevel
  const { provides: scroll } = useScroll(docId)
  const { provides: selection } = useSelectionCapability()
  const { provides: capture, state: captureState } = useCapture(docId)

  const setMode = (m: Mode) => {
    setModeState(m)
    localStorage.setItem("rp-hl-mode", m)
  }
  /** Sends a saved highlight's markdown to the note or the clipboard, per the mode. */
  const deliver = useCallback(
    (markdown: Promise<string>, image?: Blob) => {
      if (mode === "note") markdown.then(onInsert, () => {})
      else void copyHighlight(markdown, image)
    },
    [mode, onInsert],
  )

  const setColor = (c: HighlightColor) => {
    setColorState(c)
    localStorage.setItem("rp-hl-color", c)
  }

  useEffect(() => {
    api.highlights(projectId, source.id).then(setHighlights, (e) => toast.error(e.message))
  }, [projectId, source.id])

  // Text selection -> highlight, then the quote goes to the note or the clipboard.
  const highlightSelection = useCallback(
    (c: HighlightColor) => {
      if (!selection) return
      const scope = selection.forDocument(docId)
      const parts = scope.getFormattedSelection()
      if (!parts.length) return
      setColor(c)
      const saved = (async () => {
        const text = tidy(await scope.getSelectedText().toPromise())
        const created: Highlight[] = []
        for (const part of parts) {
          created.push(
            await api.addTextHighlight(projectId, source.id, {
              pageIndex: part.pageIndex,
              rects: part.segmentRects as PdfRect[],
              color: c,
              text,
            }),
          )
        }
        scope.clear()
        setHighlights((hs) => [...hs, ...created])
        return quoteMarkdown(source, created[0])
      })()
      saved.catch((err) => toast.error(`Couldn't save highlight: ${(err as Error).message}`))
      deliver(saved)
    },
    [selection, docId, projectId, source, deliver],
  )

  const copySelection = () => {
    selection?.forDocument(docId).copyToClipboard()
    selection?.forDocument(docId).clear()
  }

  // Area capture -> image highlight; the figure goes to the note or the clipboard.
  useEffect(() => {
    if (!capture) return
    return capture.onCaptureArea((ev) => {
      if (capture.isMarqueeCaptureActive()) capture.disableMarqueeCapture()
      const saved = api
        .addAreaHighlight(projectId, source.id, { pageIndex: ev.pageIndex, rects: [ev.rect as PdfRect], color }, ev.blob)
        .then((h) => {
          setHighlights((hs) => [...hs, h])
          return figureMarkdown(projectId, source, h)
        })
      saved.catch((err) => toast.error(`Couldn't save the capture: ${(err as Error).message}`))
      deliver(saved, ev.blob)
    })
  }, [capture, projectId, source, color, deliver])

  // Clicking a quote or figure in the note scrolls here and flashes it.
  useEffect(() => {
    const on = (e: Event) => {
      const { sourceId, highlightId } = (e as CustomEvent).detail
      if (sourceId !== source.id) return
      const h = highlights.find((x) => x.id === highlightId)
      if (!h || !scroll) {
        if (!h) toast.error("That highlight was removed from the PDF")
        return
      }
      const r = h.rects[0]
      scroll.scrollToPage({
        pageNumber: h.pageIndex + 1,
        pageCoordinates: { x: r.origin.x, y: Math.max(0, r.origin.y - 60) },
        behavior: "smooth",
      })
      setFlash(h.id)
      window.setTimeout(() => setFlash((f) => (f === h.id ? null : f)), 1800)
    }
    window.addEventListener("rp:goto-highlight", on)
    return () => window.removeEventListener("rp:goto-highlight", on)
  }, [highlights, scroll, source.id])

  const recolor = async (h: Highlight, c: HighlightColor) => {
    try {
      const updated = await api.recolorHighlight(projectId, source.id, h.id, c)
      setHighlights((hs) => hs.map((x) => (x.id === h.id ? updated : x)))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }
  const remove = async (h: Highlight) => {
    try {
      await api.deleteHighlight(projectId, source.id, h.id)
      setHighlights((hs) => hs.filter((x) => x.id !== h.id))
      setActive(null)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const capturing = captureState.isMarqueeCaptureActive

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={(e) => e.key === "Escape" && setActive(null)}>
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
        <div className="flex items-center gap-1 px-1" role="radiogroup" aria-label="Highlight color">
          {COLORS.map((c) => (
            <button
              key={c.id}
              role="radio"
              aria-checked={color === c.id}
              aria-label={c.id}
              onClick={() => setColor(c.id)}
              className={cn(
                "size-4 rounded-full border border-black/10 transition-transform",
                color === c.id ? "scale-110 ring-2 ring-ring ring-offset-1 ring-offset-background" : "hover:scale-110",
              )}
              style={{ background: c.dot }}
            />
          ))}
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-7 gap-1.5 px-2 text-xs text-muted-foreground", capturing && "bg-muted text-foreground")}
              onClick={() => capture?.toggleMarqueeCapture()}
            >
              <ScanIcon className="size-3.5" /> {capturing ? "Drag over an area" : "Capture area"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Drag a box over a figure or table to keep it as an image</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
              onClick={() => setMode(mode === "copy" ? "note" : "copy")}
            >
              {mode === "copy" ? <ClipboardCopyIcon className="size-3.5" /> : <NotebookPenIcon className="size-3.5" />}
              {mode === "copy" ? "Copy" : "Add to note"}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {mode === "copy"
              ? "New highlights and captures are copied, so you paste them where you want. Click to add them to the note automatically."
              : "New highlights and captures go straight into the note. Click to copy them instead."}
          </TooltipContent>
        </Tooltip>
        <div className="ml-auto flex items-center">
          <Button variant="ghost" size="icon" className="size-7" onClick={() => zoom.provides?.zoomOut()} aria-label="Zoom out">
            <MinusIcon className="size-3.5" />
          </Button>
          <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon" className="size-7" onClick={() => zoom.provides?.zoomIn()} aria-label="Zoom in">
            <PlusIcon className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <Viewport documentId={docId} className="absolute inset-0 bg-muted">
          <Scroller
            documentId={docId}
            renderPage={({ pageIndex, width, height }) => (
              <div style={{ width, height, position: "relative" }} className="bg-white shadow-sm select-none">
                <PagePointerProvider documentId={docId} pageIndex={pageIndex} style={{ width, height }}>
                  <RenderLayer documentId={docId} pageIndex={pageIndex} style={{ pointerEvents: "none" }} />
                  {highlights
                    .filter((h) => h.pageIndex === pageIndex)
                    // Area boxes underneath, so text highlights inside them stay clickable.
                    .sort((a, b) => Number(!!b.image) - Number(!!a.image))
                    .map((h) => (
                      <HighlightMarks
                        key={h.id}
                        h={h}
                        scale={scale}
                        flashing={flash === h.id}
                        active={active === h.id}
                        onClick={() => setActive((a) => (a === h.id ? null : h.id))}
                      />
                    ))}
                  <SelectionLayer
                    documentId={docId}
                    pageIndex={pageIndex}
                    background="rgba(59, 130, 246, 0.28)"
                    selectionMenu={(props) => (
                      <SelectionMenu {...props} color={color} onHighlight={highlightSelection} onCopy={copySelection} />
                    )}
                  />
                  <MarqueeCapture
                    documentId={docId}
                    pageIndex={pageIndex}
                    stroke={colorOf(color).dot}
                    fill={colorOf(color).fill}
                  />
                  {highlights
                    .filter((h) => h.pageIndex === pageIndex && h.id === active)
                    .map((h) => (
                      <HighlightMenu
                        key={h.id}
                        h={h}
                        scale={scale}
                        onColor={(c) => recolor(h, c)}
                        onDelete={() => remove(h)}
                        onAddToNote={() => {
                          onInsert(h.image ? figureMarkdown(projectId, source, h) : quoteMarkdown(source, h))
                          setActive(null)
                        }}
                        onCopy={() => {
                          const md = h.image ? figureMarkdown(projectId, source, h) : quoteMarkdown(source, h)
                          const image = h.image
                            ? fetch(api.assetUrl(projectId, source.id, h.image)).then((r) => r.blob())
                            : undefined
                          void copyHighlight(Promise.resolve(md), image)
                          setActive(null)
                        }}
                      />
                    ))}
                </PagePointerProvider>
              </div>
            )}
          />
        </Viewport>
      </div>
    </div>
  )
}

function HighlightMarks({
  h,
  scale,
  flashing,
  active,
  onClick,
}: {
  h: Highlight
  scale: number
  flashing: boolean
  active: boolean
  onClick: () => void
}) {
  const c = colorOf(h.color)
  // A drag that starts on a highlight is a text selection, not a click on it.
  const down = useRef<{ x: number; y: number } | null>(null)
  return (
    <>
      {h.rects.map((r, i) => (
        <div
          key={i}
          onPointerDown={(e) => (down.current = { x: e.clientX, y: e.clientY })}
          onClick={(e) => {
            const d = down.current
            if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) onClick()
          }}
          className={cn("absolute cursor-pointer rounded-[2px]", flashing && "animate-pulse")}
          style={{
            left: r.origin.x * scale,
            top: r.origin.y * scale,
            width: r.size.width * scale,
            height: r.size.height * scale,
            background: h.image ? "transparent" : c.fill,
            border: h.image ? `2px solid ${c.dot}` : undefined,
            mixBlendMode: h.image ? undefined : "multiply",
            outline: flashing || active ? `2px solid ${c.dot}` : undefined,
            outlineOffset: 1,
          }}
        />
      ))}
    </>
  )
}

function HighlightMenu({
  h,
  scale,
  onColor,
  onDelete,
  onAddToNote,
  onCopy,
}: {
  h: Highlight
  scale: number
  onColor: (c: HighlightColor) => void
  onDelete: () => void
  onAddToNote: () => void
  onCopy: () => void
}) {
  const r = h.rects[0]
  return (
    <div
      className="absolute z-20 flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-md"
      style={{ left: r.origin.x * scale, top: Math.max(0, r.origin.y * scale - 40) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {COLORS.map((c) => (
        <button
          key={c.id}
          aria-label={`Make ${c.id}`}
          onClick={() => onColor(c.id)}
          className={cn("size-4 rounded-full border border-black/10", h.color === c.id && "ring-2 ring-ring ring-offset-1")}
          style={{ background: c.dot }}
        />
      ))}
      <div className="mx-0.5 h-4 w-px bg-border" />
      <Button variant="ghost" size="icon" className="size-6" onClick={onCopy} aria-label="Copy">
        <ClipboardCopyIcon className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="size-6" onClick={onAddToNote} aria-label="Add to note">
        <NotebookPenIcon className="size-3.5" />
      </Button>
      <Button variant="ghost" size="icon" className="size-6" onClick={onDelete} aria-label="Remove highlight">
        <Trash2Icon className="size-3.5" />
      </Button>
    </div>
  )
}

function SelectionMenu({
  menuWrapperProps,
  placement,
  rect,
  color,
  onHighlight,
  onCopy,
}: SelectionSelectionMenuProps & {
  color: HighlightColor
  onHighlight: (c: HighlightColor) => void
  onCopy: () => void
}) {
  const top = placement.suggestTop ? -44 : rect.size.height + 8
  return (
    <div {...menuWrapperProps}>
      <div
        className="absolute flex items-center gap-1 rounded-lg border bg-popover p-1 shadow-md"
        style={{ top, pointerEvents: "auto", cursor: "default" }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="px-1 text-xs text-muted-foreground">Highlight</span>
        {COLORS.map((c) => (
          <button
            key={c.id}
            aria-label={`Highlight ${c.id}`}
            onClick={() => onHighlight(c.id)}
            className={cn(
              "size-5 rounded-full border border-black/10 hover:scale-110",
              color === c.id && "ring-2 ring-ring ring-offset-1",
            )}
            style={{ background: c.dot }}
          />
        ))}
        <div className="mx-0.5 h-4 w-px bg-border" />
        <Button variant="ghost" size="icon" className="size-6" onClick={onCopy} aria-label="Copy text">
          <CopyIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}
