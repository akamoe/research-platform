import type React from "react"
import { useRef, useState } from "react"
import type { TListElement } from "platejs"
import { isOrderedList } from "@platejs/list"
import { useTodoListElement, useTodoListElementState } from "@platejs/list/react"
import { PlateElement, PlateLeaf, useEditorRef, type PlateElementProps, type PlateLeafProps, type RenderNodeWrapper } from "platejs/react"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

export function ParagraphElement(props: PlateElementProps) {
  return <PlateElement {...props} className="m-0 px-0 py-1">{props.children}</PlateElement>
}

const headingClass = {
  h1: "mt-8 mb-2 font-heading text-3xl font-semibold tracking-tight",
  h2: "mt-7 mb-1.5 font-heading text-2xl font-semibold tracking-tight",
  h3: "mt-6 mb-1 font-heading text-xl font-semibold tracking-tight",
  h4: "mt-5 mb-1 font-heading text-lg font-semibold",
  h5: "mt-4 mb-1 font-heading text-base font-semibold",
  h6: "mt-4 mb-1 font-heading text-sm font-semibold uppercase tracking-wide text-muted-foreground",
} as const

const heading = (as: keyof typeof headingClass) =>
  function Heading(props: PlateElementProps) {
    return <PlateElement as={as} {...props} className={headingClass[as]}>{props.children}</PlateElement>
  }
export const H1Element = heading("h1")
export const H2Element = heading("h2")
export const H3Element = heading("h3")
export const H4Element = heading("h4")
export const H5Element = heading("h5")
export const H6Element = heading("h6")

export function BlockquoteElement(props: PlateElementProps) {
  return (
    <PlateElement as="blockquote" {...props} className="my-2 border-l-2 pl-4 italic text-muted-foreground">
      {props.children}
    </PlateElement>
  )
}

export function HrElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="py-4">
      <div contentEditable={false}>
        <hr className="h-px border-none bg-border" />
      </div>
      {props.children}
    </PlateElement>
  )
}

/** Links like `#hl/<paperId>/<highlightId>` jump to a highlight in the open PDF. */
export function gotoHighlight(target: string) {
  const m = target.match(/^#?hl\/([\w-]+)\/([\w-]+)$/)
  if (!m) return false
  window.dispatchEvent(new CustomEvent("rp:goto-highlight", { detail: { sourceId: m[1], highlightId: m[2] } }))
  return true
}

export function LinkElement(props: PlateElementProps) {
  const url = (props.element as { url?: string }).url ?? ""
  const internal = url.startsWith("#hl/")
  return (
    <PlateElement
      as="a"
      {...props}
      attributes={{
        ...props.attributes,
        href: url,
        ...(internal ? {} : { target: "_blank", rel: "noreferrer" }),
        onClick: (e: React.MouseEvent) => {
          if (internal) {
            e.preventDefault()
            gotoHighlight(url)
          } else if (e.metaKey || e.ctrlKey) {
            window.open(url, "_blank", "noreferrer")
          }
        },
        title: internal ? "Show in the PDF" : "Ctrl/⌘ click to open",
      }}
      className={
        internal
          ? "cursor-pointer rounded bg-muted px-1 py-0.5 font-sans text-xs font-medium text-muted-foreground no-underline hover:text-foreground"
          : "font-medium text-primary underline decoration-primary/40 underline-offset-4"
      }
    >
      {props.children}
    </PlateElement>
  )
}

export function ImageElement(props: PlateElementProps) {
  const editor = useEditorRef()
  const { url, title, caption, width } = props.element as {
    url?: string
    title?: string
    caption?: { text: string }[]
    width?: number
  }
  const alt = caption?.map((c) => c.text).join("") ?? ""
  const jumps = typeof title === "string" && title.startsWith("hl/")
  const frame = useRef<HTMLDivElement>(null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const shown = dragWidth ?? width

  // Drag either side handle to resize; the width is saved in the note's markdown.
  const startResize = (e: React.PointerEvent, side: 1 | -1) => {
    e.preventDefault()
    e.stopPropagation()
    const box = frame.current
    if (!box) return
    const startX = e.clientX
    const startW = box.getBoundingClientRect().width
    const maxW = box.parentElement?.clientWidth ?? startW
    let w = startW
    const move = (ev: PointerEvent) => {
      w = Math.round(Math.min(maxW, Math.max(80, startW + (ev.clientX - startX) * side)))
      setDragWidth(w)
    }
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
      setDragWidth(null)
      const at = editor.api.findPath(props.element)
      if (at) editor.tf.setNodes({ width: w } as Partial<typeof props.element>, { at })
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  return (
    <PlateElement {...props} className="my-3">
      <div contentEditable={false} className="select-none">
        <div ref={frame} className="group relative inline-block max-w-full align-top" style={{ width: shown }}>
          <img
            src={url}
            alt={alt}
            draggable={false}
            onClick={() => jumps && gotoHighlight(title!)}
            title={jumps ? "Show in the PDF" : alt}
            className={cn(
              "block max-w-full rounded-md border",
              shown ? "h-auto w-full" : "max-h-[480px]",
              jumps && "cursor-pointer hover:opacity-90",
            )}
          />
          {([-1, 1] as const).map((side) => (
            <div
              key={side}
              aria-hidden
              onPointerDown={(e) => startResize(e, side)}
              className={cn(
                "absolute top-0 flex h-full w-3 cursor-ew-resize items-center justify-center opacity-0 transition-opacity group-hover:opacity-100",
                dragWidth !== null && "opacity-100",
                side === -1 ? "-left-1.5" : "-right-1.5",
              )}
            >
              <div className="h-10 max-h-[60%] w-1.5 rounded-full border border-background bg-foreground/50 shadow-sm" />
            </div>
          ))}
        </div>
      </div>
      {props.children}
    </PlateElement>
  )
}

export function CodeBlockElement(props: PlateElementProps) {
  return (
    <PlateElement {...props} className="my-2">
      <pre className="overflow-x-auto rounded-md bg-muted px-4 py-3 font-mono text-[13px] leading-relaxed not-italic">
        <code>{props.children}</code>
      </pre>
    </PlateElement>
  )
}
export function CodeLineElement(props: PlateElementProps) {
  return <PlateElement {...props}>{props.children}</PlateElement>
}

export function CodeLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="code" className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
      {props.children}
    </PlateLeaf>
  )
}

/** A citation like [@walker2002practice], so it reads as a reference rather than plain text. */
export function CitationLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} className="rounded-sm bg-muted px-0.5 font-sans text-[0.88em] text-muted-foreground">
      {props.children}
    </PlateLeaf>
  )
}

export function HighlightLeaf(props: PlateLeafProps) {
  return (
    <PlateLeaf {...props} as="mark" className="rounded-sm bg-highlight/70 px-0.5 text-inherit">
      {props.children}
    </PlateLeaf>
  )
}

/** Renders indent-based lists (from Plate's ListPlugin) as real <ul>/<ol>. */
export const BlockList: RenderNodeWrapper = (props) => {
  if (!props.element.listStyleType) return
  return (p) => <List {...p} />
}

function List(props: PlateElementProps) {
  const { listStart, listStyleType } = props.element as TListElement
  const Tag = isOrderedList(props.element) ? "ol" : "ul"
  if (listStyleType === "todo") {
    return (
      <ul className="relative m-0 list-none p-0">
        <TodoMarker {...props} />
        <li className={cn((props.element.checked as boolean) && "text-muted-foreground line-through")}>
          {props.children}
        </li>
      </ul>
    )
  }
  return (
    <Tag className="relative m-0 p-0" style={{ listStyleType }} start={listStart}>
      <li>{props.children}</li>
    </Tag>
  )
}

function TodoMarker(props: PlateElementProps) {
  const state = useTodoListElementState({ element: props.element })
  const { checkboxProps } = useTodoListElement(state)
  return (
    <div contentEditable={false}>
      <Checkbox className="absolute top-1.5 -left-6" {...checkboxProps} />
    </div>
  )
}
