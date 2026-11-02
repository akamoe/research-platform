import { memo, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  BaseEdge,
  NodeResizer,
  getStraightPath,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react"
import { getStroke } from "perfect-freehand"
import { CircleIcon, MousePointer2Icon, MoveUpRightIcon, PencilIcon, SquareIcon, TypeIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { CanvasShape } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
  COLORS,
  CanvasCtx,
  RELATION_STYLE,
  STROKE,
  borderPoint,
  center,
  colorOf,
  newId,
  strokePath,
  type ArrowEdge,
  type LinkEdge,
  type ShapeNode,
  type Tool,
} from "./shared"

export const TOOLS: { id: Tool; label: string; key: string; icon: typeof SquareIcon }[] = [
  { id: "select", label: "Select", key: "V", icon: MousePointer2Icon },
  { id: "rect", label: "Rectangle", key: "R", icon: SquareIcon },
  { id: "ellipse", label: "Ellipse", key: "O", icon: CircleIcon },
  { id: "arrow", label: "Arrow", key: "A", icon: MoveUpRightIcon },
  { id: "draw", label: "Pen", key: "P", icon: PencilIcon },
  { id: "text", label: "Text", key: "T", icon: TypeIcon },
]

/** The tools down the left side of the canvas, plus the color for new and selected shapes. */
export function Toolbar({ tool, onTool, color, onColor }: { tool: Tool; onTool: (t: Tool) => void; color: string; onColor: (c: string) => void }) {
  return (
    <div className="absolute top-3 left-3 z-10 flex flex-col items-center gap-1 rounded-lg border bg-background p-1 shadow-xs">
      <ToggleGroup
        type="single"
        size="sm"
        spacing={1}
        orientation="vertical"
        value={tool}
        onValueChange={(v) => v && onTool(v as Tool)}
        className="flex-col"
        aria-label="Canvas tools"
      >
        {TOOLS.map((t) => (
          <Tooltip key={t.id}>
            <TooltipTrigger asChild>
              <ToggleGroupItem value={t.id} aria-label={t.label} className="size-8 px-0">
                <t.icon />
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent side="right">
              {t.label} <span className="ml-1 opacity-60">{t.key}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </ToggleGroup>
      <Separator className="my-0.5 !w-6" />
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Color">
                <span className="size-4 rounded-full ring-1 ring-border" style={{ background: colorOf(color) }} />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">Color</TooltipContent>
        </Tooltip>
        <PopoverContent side="right" align="end" className="w-auto p-1.5">
          <div className="grid grid-cols-4 gap-1">
            {COLORS.map((c) => (
              <button
                key={c.id}
                title={c.label}
                aria-label={c.label}
                onClick={() => onColor(c.id)}
                className={cn("flex size-8 items-center justify-center rounded-md hover:bg-accent", c.id === color && "bg-accent")}
              >
                <span className="size-4 rounded-full" style={{ background: c.value }} />
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function ArrowHead({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" style={{ fill: color }} />
      </marker>
    </defs>
  )
}

/** Rectangles, ellipses, text, pen strokes and loose arrows the student draws on the canvas. */
export const ShapeNodeView = memo(function ShapeNodeView({ id, data, selected, width, height }: NodeProps<ShapeNode>) {
  const ctx = useContext(CanvasCtx)!
  const { shape } = data
  const color = colorOf(shape.color)
  const editing = ctx.editingShape === id
  const [draft, setDraft] = useState(shape.text ?? "")
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (!editing) return
    setDraft(shape.text ?? "")
    // A new node stays hidden until React Flow has measured it, and hidden fields can't take focus.
    let tries = 0
    let frame = 0
    const focus = () => {
      area.current?.focus()
      if (document.activeElement !== area.current && tries++ < 20) frame = requestAnimationFrame(focus)
    }
    frame = requestAnimationFrame(focus)
    return () => cancelAnimationFrame(frame)
  }, [editing]) // eslint-disable-line react-hooks/exhaustive-deps
  const w = width ?? shape.w
  const h = height ?? shape.h

  const finish = () => {
    ctx.setEditingShape(null)
    const text = draft.trim()
    if (shape.type === "text" && !text) ctx.removeShapes([id])
    else if (text !== (shape.text ?? "")) ctx.updateShape(id, { text: text || undefined })
  }
  const editor = (
    <Textarea
      ref={area}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault()
          finish()
        }
        if (e.key === "Escape") finish()
        e.stopPropagation()
      }}
      placeholder={shape.type === "text" ? "Type…" : "Label"}
      className={cn(
        "nodrag nowheel min-h-0 resize-none rounded-none border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 dark:bg-transparent",
        shape.type === "text" ? "w-[240px] text-base md:text-base" : "w-full text-center text-sm",
      )}
      style={{ color: shape.type === "text" ? color : undefined }}
    />
  )
  const resizer = (
    <NodeResizer
      isVisible={selected && !editing}
      minWidth={16}
      minHeight={16}
      lineClassName="pointer-events-auto !border-ring"
      handleClassName="pointer-events-auto !size-2 !rounded-[2px] !border-ring !bg-background"
      onResizeEnd={(_, p) => ctx.updateShape(id, { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(p.width), h: Math.round(p.height) })}
    />
  )

  const freehand = useMemo(() => {
    if (shape.type !== "draw" || !shape.points) return ""
    return strokePath(getStroke(shape.points.map(([x, y]) => [x * w, y * h]), { ...STROKE, last: true }))
  }, [shape.type, shape.points, w, h])

  if (shape.type === "text") {
    return (
      <div
        className={cn("rounded-md px-1.5 py-1", selected && !editing && "ring-2 ring-ring/50")}
        onDoubleClick={() => ctx.setEditingShape(id)}
      >
        {editing ? (
          editor
        ) : (
          <p className="w-max max-w-[360px] text-base leading-snug whitespace-pre-wrap" style={{ color }}>
            {shape.text}
          </p>
        )}
      </div>
    )
  }

  if (shape.type === "draw") {
    return (
      <>
        {resizer}
        <svg width={w} height={h} className="overflow-visible">
          <path d={freehand} className="pointer-events-auto" style={{ fill: color, stroke: "transparent", strokeWidth: 10 }} />
        </svg>
      </>
    )
  }

  if (shape.type === "arrow") {
    const [[ax, ay], [bx, by]] = shape.points ?? [[0, 0], [1, 1]]
    const marker = `rp-head-${id}`
    return (
      <>
        {resizer}
        <svg width={w} height={h} className="overflow-visible">
          <ArrowHead id={marker} color={color} />
          <line x1={ax * w} y1={ay * h} x2={bx * w} y2={by * h} style={{ stroke: color, strokeWidth: 2 }} markerEnd={`url(#${marker})`} />
          <line
            x1={ax * w}
            y1={ay * h}
            x2={bx * w}
            y2={by * h}
            className="pointer-events-auto"
            style={{ stroke: "transparent", strokeWidth: 14 }}
          />
        </svg>
      </>
    )
  }

  return (
    <>
      {resizer}
      <div
        className={cn("flex size-full items-center justify-center border-2 p-2", shape.type === "ellipse" ? "rounded-[50%]" : "rounded-lg")}
        style={{ borderColor: color, background: `color-mix(in oklch, ${color} 5%, transparent)` }}
        onDoubleClick={() => ctx.setEditingShape(id)}
      >
        {editing ? editor : shape.text && <p className="text-center text-sm whitespace-pre-wrap" style={{ color }}>{shape.text}</p>}
      </div>
    </>
  )
})

/** The AI's links between cards. Hover a line for the reason. */
export function LinkEdgeView({ id, source, target, data }: EdgeProps<LinkEdge>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  if (!s || !t || !data) return null
  const a = borderPoint(s, center(t))
  const b = borderPoint(t, center(s))
  const [path] = getStraightPath({ sourceX: a.x, sourceY: a.y, targetX: b.x, targetY: b.y })
  const st = RELATION_STYLE[data.link.relation] ?? RELATION_STYLE.related
  return (
    <g>
      <title>{`${st.label}: ${data.link.why}`}</title>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={16}
        style={{
          stroke: st.stroke,
          strokeWidth: data.link.relation === "contradicts" ? 2 : 1.5,
          strokeDasharray: st.dash,
          opacity: data.link.relation === "related" ? 0.45 : 0.85,
        }}
      />
    </g>
  )
}

/** An arrow the student drew from one card or shape to another. It follows them when they move. */
export function ArrowEdgeView({ id, source, target, data, selected }: EdgeProps<ArrowEdge>) {
  const s = useInternalNode(source)
  const t = useInternalNode(target)
  if (!s || !t || !data) return null
  const a = borderPoint(s, center(t), 2)
  const b = borderPoint(t, center(s), 4)
  const [path] = getStraightPath({ sourceX: a.x, sourceY: a.y, targetX: b.x, targetY: b.y })
  const color = colorOf(data.arrow.color)
  const marker = `rp-head-${id}`
  return (
    <>
      <ArrowHead id={marker} color={color} />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={`url(#${marker})`}
        interactionWidth={16}
        style={{ stroke: color, strokeWidth: selected ? 2.75 : 2 }}
      />
    </>
  )
}

type Pt = [number, number]

/**
 * Sits over the canvas while a drawing tool is picked and turns a drag into a shape.
 * Arrows that start and end on cards or shapes become connected arrows; others are loose.
 */
export function DrawOverlay({
  tool,
  color,
  onShape,
  onArrow,
}: {
  tool: Exclude<Tool, "select">
  color: string
  onShape: (shape: CanvasShape) => void
  onArrow: (from: { x: number; y: number }, to: { x: number; y: number }) => boolean
}) {
  const flow = useReactFlow()
  const ref = useRef<HTMLDivElement>(null)
  const [preview, setPreview] = useState<Pt[] | null>(null)
  const points = useRef<Pt[]>([])

  const local = (e: React.PointerEvent): Pt => {
    const r = ref.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const toFlow = (e: React.PointerEvent): Pt => {
    const p = flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })
    return [p.x, p.y]
  }

  const finish = () => {
    const fp = points.current
    if (!fp.length) return
    const [x0, y0] = fp[0]
    const [x1, y1] = fp[fp.length - 1]
    const dragged = Math.hypot(x1 - x0, y1 - y0) * flow.getViewport().zoom > 6
    const r = (n: number) => Math.round(n)
    if (tool === "rect" || tool === "ellipse") {
      const w = dragged ? Math.abs(x1 - x0) : tool === "rect" ? 200 : 160
      const h = dragged ? Math.abs(y1 - y0) : 120
      const x = dragged ? Math.min(x0, x1) : x0 - w / 2
      const y = dragged ? Math.min(y0, y1) : y0 - h / 2
      onShape({ id: newId("s"), type: tool, x: r(x), y: r(y), w: r(Math.max(w, 16)), h: r(Math.max(h, 16)), color })
    } else if (tool === "text") {
      onShape({ id: newId("s"), type: "text", x: r(x1 - 6), y: r(y1 - 14), w: 240, h: 32, color, text: "" })
    } else if (tool === "arrow") {
      if (!dragged) return
      if (onArrow({ x: x0, y: y0 }, { x: x1, y: y1 })) return
      const pad = 8
      const x = Math.min(x0, x1) - pad
      const y = Math.min(y0, y1) - pad
      const w = Math.abs(x1 - x0) + pad * 2
      const h = Math.abs(y1 - y0) + pad * 2
      const n = (px: number, py: number): Pt => [+((px - x) / w).toFixed(4), +((py - y) / h).toFixed(4)]
      onShape({ id: newId("s"), type: "arrow", x: r(x), y: r(y), w: r(w), h: r(h), color, points: [n(x0, y0), n(x1, y1)] })
    } else if (tool === "draw") {
      const pad = STROKE.size
      const xs = fp.map((p) => p[0])
      const ys = fp.map((p) => p[1])
      const x = Math.min(...xs) - pad
      const y = Math.min(...ys) - pad
      const w = Math.max(...xs) - Math.min(...xs) + pad * 2
      const h = Math.max(...ys) - Math.min(...ys) + pad * 2
      const pts = (fp.length > 1 ? fp : [fp[0], [fp[0][0] + 0.5, fp[0][1] + 0.5] as Pt]).map(
        ([px, py]): Pt => [+((px - x) / w).toFixed(4), +((py - y) / h).toFixed(4)],
      )
      onShape({ id: newId("s"), type: "draw", x: r(x), y: r(y), w: r(w), h: r(h), color, points: pts.slice(0, 5000) })
    }
  }

  const zoom = flow.getViewport().zoom
  const c = colorOf(color)
  let shapePreview: React.ReactNode = null
  if (preview && preview.length) {
    const [[x0, y0]] = preview
    const [x1, y1] = preview[preview.length - 1]
    const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) }
    const style = { stroke: c, strokeWidth: 2, fill: `color-mix(in oklch, ${c} 5%, transparent)` }
    if (tool === "rect") shapePreview = <rect {...box} rx={8 * zoom} style={style} />
    if (tool === "ellipse")
      shapePreview = <ellipse cx={box.x + box.width / 2} cy={box.y + box.height / 2} rx={box.width / 2} ry={box.height / 2} style={style} />
    if (tool === "arrow")
      shapePreview = (
        <>
          <ArrowHead id="rp-head-preview" color={c} />
          <line x1={x0} y1={y0} x2={x1} y2={y1} style={{ stroke: c, strokeWidth: 2 }} markerEnd="url(#rp-head-preview)" />
        </>
      )
    if (tool === "draw") shapePreview = <path d={strokePath(getStroke(preview, { ...STROKE, size: STROKE.size * zoom }))} style={{ fill: c }} />
  }

  return (
    <div
      ref={ref}
      className={cn("absolute inset-0 z-[5] touch-none", tool === "text" ? "cursor-text" : "cursor-crosshair")}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        points.current = [toFlow(e)]
        setPreview([local(e)])
      }}
      onPointerMove={(e) => {
        if (!preview) return
        const p = local(e)
        if (tool === "draw") {
          const last = preview[preview.length - 1]
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return
          points.current.push(toFlow(e))
          setPreview([...preview, p])
        } else {
          points.current = [points.current[0], toFlow(e)]
          setPreview([preview[0], p])
        }
      }}
      onPointerUp={() => {
        if (!preview) return
        finish()
        points.current = []
        setPreview(null)
      }}
    >
      {shapePreview && (
        <svg className="pointer-events-none absolute inset-0 size-full overflow-visible">{shapePreview}</svg>
      )}
    </div>
  )
}
