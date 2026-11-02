import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/base.css"
import { LoaderCircleIcon, MessageSquareIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type CanvasArrow, type CanvasData, type CanvasLink, type CanvasShape, type CardKind } from "@/lib/api"
import { cn } from "@/lib/utils"
import { CardNodeView } from "./card-node"
import { ArrowEdgeView, DrawOverlay, LinkEdgeView, ShapeNodeView, TOOLS, Toolbar } from "./drawing"
import {
  CARD_H,
  CARD_W,
  CanvasCtx,
  KINDS,
  RELATION_STYLE,
  newId,
  type AnyEdge,
  type AnyNode,
  type CardNode,
  type Ctx,
  type ShapeNode,
  type Tool,
} from "./shared"

interface Props {
  projectId: string
  chatOpen: boolean
  onToggleChat: () => void
}

type Drawing = { shapes: CanvasShape[]; arrows: CanvasArrow[] }

export function CanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ projectId, chatOpen, onToggleChat }: Props) {
  const [data, setData] = useState<CanvasData | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<AnyEdge>([])
  const [reading, setReading] = useState(false)
  const [aiOff, setAiOff] = useState<string | null>(null)
  const [themesOpen, setThemesOpen] = useState(() => localStorage.getItem("rp-canvas-themes") !== "0")
  const [focus, setFocus] = useState<Set<string>>(new Set())
  const [tool, setTool] = useState<Tool>("select")
  const [color, setColor] = useState(() => localStorage.getItem("rp-canvas-color") ?? "default")
  const [editingShape, setEditingShape] = useState<string | null>(null)
  const [pageTitles, setPageTitles] = useState<Record<string, string>>({})
  const flow = useReactFlow<AnyNode, AnyEdge>()
  const wrapper = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    api.canvas(projectId).then(setData, (e) => toast.error(e.message))
    api.knowledge(projectId).then(
      (k) => setPageTitles(Object.fromEntries(k.pages.map((p) => [p.id, p.title]))),
      () => {},
    )
  }, [projectId])

  // Cards and shapes -> React Flow nodes, keeping a node where it is while it's dragged or resized.
  useEffect(() => {
    if (!data) return
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]))
      const pos = (id: string, x: number, y: number) => {
        const o = old.get(id)
        return o?.dragging || o?.resizing ? o.position : { x, y }
      }
      const shapeNode = (shape: CanvasShape): ShapeNode => {
        const o = old.get(shape.id) as ShapeNode | undefined
        const sized = shape.type !== "text"
        return {
          ...o,
          id: shape.id,
          type: "shape",
          position: pos(shape.id, shape.x, shape.y),
          data: { shape },
          // Boxes sit behind cards so they can group them; strokes, arrows and text sit on top.
          zIndex: shape.type === "rect" || shape.type === "ellipse" ? -1 : 1,
          width: sized ? (o?.resizing ? o.width : shape.w) : undefined,
          height: sized ? (o?.resizing ? o.height : shape.h) : undefined,
          // Strokes and loose arrows only catch the pointer on the line itself, not their whole box.
          style: shape.type === "draw" || shape.type === "arrow" ? { pointerEvents: "none" } : undefined,
        }
      }
      const cardNode = (card: CanvasData["cards"][number]): CardNode => ({
        ...(old.get(card.id) as CardNode | undefined),
        id: card.id,
        type: "card",
        position: pos(card.id, card.x, card.y),
        data: { card },
      })
      return [...(data.shapes ?? []).map(shapeNode), ...data.cards.map(cardNode)]
    })
  }, [data, setNodes])

  useEffect(() => {
    if (!data) return
    setEdges((prev) => {
      const selected = new Set(prev.filter((e) => e.selected).map((e) => e.id))
      return [
        ...data.links.map((link) => ({
          id: link.id,
          source: link.from,
          target: link.to,
          type: "link" as const,
          data: { link },
          selectable: false,
          deletable: false,
          focusable: false,
        })),
        ...(data.arrows ?? []).map((arrow) => ({
          id: arrow.id,
          source: arrow.from,
          target: arrow.to,
          type: "arrow" as const,
          data: { arrow },
          selected: selected.has(arrow.id),
        })),
      ]
    })
  }, [data, setEdges])

  // ---------- drawing: saved a moment after the last change ----------
  const drawing = useRef<Drawing>({ shapes: [], arrows: [] })
  const dirty = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (data) drawing.current = { shapes: data.shapes ?? [], arrows: data.arrows ?? [] }
  }, [data])

  const flushDrawing = useCallback(() => {
    window.clearTimeout(saveTimer.current)
    if (!dirty.current) return
    dirty.current = false
    api.saveDrawing(projectId, drawing.current).catch((e) => toast.error(`Couldn't save the drawing: ${e.message}`))
  }, [projectId])

  const changeDrawing = useCallback(
    (fn: (d: Drawing) => Partial<Drawing>) => {
      setData((d) => (d ? { ...d, ...fn({ shapes: d.shapes ?? [], arrows: d.arrows ?? [] }) } : d))
      dirty.current = true
      window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(flushDrawing, 600)
    },
    [flushDrawing],
  )
  useEffect(() => () => flushDrawing(), [flushDrawing])

  const removeShapes = useCallback(
    (ids: string[]) => {
      if (!ids.length) return
      const gone = new Set(ids)
      const before = drawing.current
      changeDrawing((d) => ({
        shapes: d.shapes.filter((s) => !gone.has(s.id)),
        arrows: d.arrows.filter((a) => !gone.has(a.from) && !gone.has(a.to)),
      }))
      const removed = before.shapes.filter((s) => gone.has(s.id) && (s.type !== "text" || s.text))
      const removedArrows = before.arrows.filter((a) => gone.has(a.from) || gone.has(a.to))
      if (!removed.length) return
      toast(removed.length > 1 ? "Shapes removed" : "Shape removed", {
        action: {
          label: "Undo",
          onClick: () => changeDrawing((d) => ({ shapes: [...d.shapes, ...removed], arrows: [...d.arrows, ...removedArrows] })),
        },
      })
    },
    [changeDrawing],
  )

  const addShape = (shape: CanvasShape) => {
    changeDrawing((d) => ({ shapes: [...d.shapes, shape] }))
    if (shape.type === "text") setEditingShape(shape.id)
    if (shape.type !== "draw") setTool("select")
  }

  /** An arrow drawn from one card or shape to another. Returns false if it doesn't start and end on one. */
  const addArrow = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const rank = (n: AnyNode) => {
      if (n.type === "card") return 0
      const s = n.data.shape
      return s.type === "text" ? 1 : 2 + (s.w * s.h) / 1e9
    }
    const at = (p: { x: number; y: number }) =>
      flow
        .getIntersectingNodes({ x: p.x - 2, y: p.y - 2, width: 4, height: 4 }, true)
        .filter((n) => !(n.type === "shape" && (n.data.shape.type === "draw" || n.data.shape.type === "arrow")))
        .sort((a, b) => rank(a) - rank(b))[0]
    const a = at(from)
    const b = at(to)
    if (!a || !b || a.id === b.id) return false
    changeDrawing((d) => ({ arrows: [...d.arrows, { id: newId("a"), from: a.id, to: b.id, color }] }))
    setTool("select")
    return true
  }

  // ---------- the AI reads new and edited cards a moment after the student stops writing ----------
  const think = useCallback(async () => {
    setReading(true)
    try {
      const next = await api.think(projectId)
      // Keep the drawing as it is here; it may have changes that aren't saved yet.
      setData((d) => ({ ...next, shapes: d?.shapes ?? next.shapes, arrows: d?.arrows ?? next.arrows }))
      setAiOff(null)
    } catch (err) {
      const msg = (err as Error).message
      if (/pick a model|api key/i.test(msg)) setAiOff(msg)
      else toast.error(`The AI couldn't read your notes: ${msg}`)
    } finally {
      setReading(false)
    }
  }, [projectId])

  const scheduleThink = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(think, 2500)
  }, [think])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const unread = data?.cards.some((c) => !c.analyzedAt || c.updatedAt > c.analyzedAt)
  useEffect(() => {
    if (unread && !reading && !aiOff) scheduleThink()
  }, [unread]) // eslint-disable-line react-hooks/exhaustive-deps

  // Tool shortcuts, like most drawing apps. Off while a text box is about to take the typing.
  const editingRef = useRef(editingShape)
  editingRef.current = editingShape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || editingRef.current) return
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return
      if (e.key === "Escape") return setTool("select")
      const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase())
      if (t) {
        e.preventDefault()
        setTool(t.id)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  /** A free spot near the middle of what the student is looking at. */
  const freeSpot = () => {
    const box = wrapper.current?.getBoundingClientRect()
    const mid = box
      ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 - 60 })
      : { x: 0, y: 0 }
    const cards = data?.cards ?? []
    const taken = (x: number, y: number) =>
      cards.some((c) => Math.abs(c.x - x) < CARD_W + 16 && Math.abs(c.y - y) < CARD_H + 16)
    const sx = mid.x - CARD_W / 2
    const sy = mid.y - CARD_H / 2
    for (let ring = 0; ring < 8; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue
          const x = sx + dx * (CARD_W + 24)
          const y = sy + dy * (CARD_H + 24)
          if (!taken(x, y)) return { x: Math.round(x), y: Math.round(y) }
        }
      }
    }
    return { x: Math.round(sx), y: Math.round(sy + (CARD_H + 24) * 8) }
  }

  const add = async (text: string, kind?: CardKind) => {
    try {
      const card = await api.addCard(projectId, { text, kind, ...freeSpot() })
      setData((d) => (d ? { ...d, cards: [...d.cards, card] } : d))
      scheduleThink()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const ctx = useMemo<Ctx>(
    () => ({
      projectId,
      reading,
      focus,
      pageTitle: (id) => pageTitles[id] ?? id.split("/").pop()?.replace(/-/g, " ") ?? id,
      edit: async (id, text) => {
        try {
          const card = await api.updateCard(projectId, id, { text })
          setData((d) =>
            d
              ? {
                  ...d,
                  cards: d.cards.map((c) => (c.id === id ? card : c)),
                  // Its links were about the old text.
                  links: card.note ? d.links : d.links.filter((l) => l.from !== id && l.to !== id),
                }
              : d,
          )
          scheduleThink()
        } catch (err) {
          toast.error((err as Error).message)
        }
      },
      setKind: async (id, kind) => {
        try {
          const card = await api.updateCard(projectId, id, { kind })
          setData((d) => (d ? { ...d, cards: d.cards.map((c) => (c.id === id ? card : c)) } : d))
        } catch (err) {
          toast.error((err as Error).message)
        }
      },
      editingShape,
      setEditingShape,
      updateShape: (id, patch) => changeDrawing((d) => ({ shapes: d.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)) })),
      removeShapes,
    }),
    [projectId, reading, focus, pageTitles, scheduleThink, editingShape, changeDrawing, removeShapes],
  )

  const removeCards = async (ids: string[]) => {
    for (const id of ids) {
      try {
        await api.removeCard(projectId, id)
        setData((d) =>
          d
            ? {
                ...d,
                cards: d.cards.filter((c) => c.id !== id),
                links: d.links.filter((l) => l.from !== id && l.to !== id),
                arrows: (d.arrows ?? []).filter((a) => a.from !== id && a.to !== id),
              }
            : d,
        )
        toast("Card removed", {
          action: {
            label: "Undo",
            onClick: async () => {
              const card = await api.restoreCard(projectId, id)
              setData((d) => (d ? { ...d, cards: [...d.cards, card] } : d))
              scheduleThink()
            },
          },
        })
      } catch (err) {
        toast.error((err as Error).message)
      }
    }
  }

  const selectedShapes = nodes.filter((n) => n.selected && n.type === "shape").map((n) => n.id)
  const selectedArrows = edges.filter((e) => e.selected && e.type === "arrow").map((e) => e.id)
  const pickColor = (c: string) => {
    setColor(c)
    localStorage.setItem("rp-canvas-color", c)
    if (!selectedShapes.length && !selectedArrows.length) return
    changeDrawing((d) => ({
      shapes: d.shapes.map((s) => (selectedShapes.includes(s.id) ? { ...s, color: c } : s)),
      arrows: d.arrows.map((a) => (selectedArrows.includes(a.id) ? { ...a, color: c } : a)),
    }))
  }

  const showCards = (ids: string[]) => {
    setFocus(new Set(ids))
    flow.fitView({ nodes: ids.map((id) => ({ id })), duration: 400, padding: 0.4, maxZoom: 1.2 })
    window.setTimeout(() => setFocus(new Set()), 2400)
  }

  const toggleThemes = () => {
    setThemesOpen((o) => {
      localStorage.setItem("rp-canvas-themes", o ? "0" : "1")
      return !o
    })
  }

  const status = aiOff
    ? "AI is off: pick a model in the chat"
    : reading
      ? "Reading your notes…"
      : unread
        ? "Waiting to read…"
        : data?.cards.length
          ? "Up to date"
          : ""

  const empty = data && data.cards.length === 0 && !data.shapes?.length

  return (
    <CanvasCtx.Provider value={ctx}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <SidebarTrigger className="text-muted-foreground" />
          <span className="text-sm font-medium">Canvas</span>
          <span className={cn("flex items-center gap-1.5 text-xs text-muted-foreground", aiOff && "text-amber-600 dark:text-amber-400")}>
            {reading && <LoaderCircleIcon className="size-3.5 animate-spin" />}
            {status}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("h-8 gap-1.5 text-muted-foreground", themesOpen && "bg-muted text-foreground")}
                  onClick={toggleThemes}
                >
                  <SparklesIcon className="size-4" /> Themes
                </Button>
              </TooltipTrigger>
              <TooltipContent>What's emerging from your notes</TooltipContent>
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
              <TooltipContent>Chat (Ctrl/⌘ J)</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 border-t">
          <div ref={wrapper} className="relative min-w-0 flex-1">
            {data && (
              <ReactFlow<AnyNode, AnyEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={(_, __, dragged) => {
                  const moved = new Map(dragged.map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]))
                  const cards = dragged.filter((n) => n.type === "card")
                  if (cards.length) {
                    setData((d) => (d ? { ...d, cards: d.cards.map((c) => ({ ...c, ...moved.get(c.id) })) } : d))
                    for (const n of cards) api.updateCard(projectId, n.id, moved.get(n.id)!).catch(() => {})
                  }
                  if (dragged.some((n) => n.type === "shape")) {
                    changeDrawing((d) => ({ shapes: d.shapes.map((s) => ({ ...s, ...moved.get(s.id) })) }))
                  }
                }}
                onNodesDelete={(ns) => {
                  removeCards(ns.filter((n) => n.type === "card").map((n) => n.id))
                  removeShapes(ns.filter((n) => n.type === "shape").map((n) => n.id))
                }}
                onEdgesDelete={(es) => {
                  const gone = new Set(es.filter((e) => e.type === "arrow").map((e) => e.id))
                  if (gone.size) changeDrawing((d) => ({ arrows: d.arrows.filter((a) => !gone.has(a.id)) }))
                }}
                deleteKeyCode={["Delete", "Backspace"]}
                nodesConnectable={false}
                elevateNodesOnSelect={false}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                className="bg-muted/40"
              >
                <Background gap={24} size={1} color="var(--border)" />
                <Controls
                  showInteractive={false}
                  position="bottom-left"
                  className="overflow-hidden rounded-lg border bg-background shadow-xs [&_button]:border-b [&_button]:bg-background [&_button]:fill-foreground [&_button:hover]:bg-muted"
                />
              </ReactFlow>
            )}
            {tool !== "select" && <DrawOverlay tool={tool} color={color} onShape={addShape} onArrow={addArrow} />}
            {empty && tool === "select" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                <div className="max-w-sm text-center text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Write whatever you're thinking.</p>
                  <p className="mt-1">
                    One thought per card. The AI quietly sorts them, notes what to check, links related ones, flags
                    contradictions and points out themes. It won't write anything for you.
                  </p>
                </div>
              </div>
            )}
            <Toolbar tool={tool} onTool={setTool} color={color} onColor={pickColor} />
            {!!data?.links.length && <Legend relations={[...new Set(data.links.map((l) => l.relation))]} />}
            <Composer onAdd={add} />
          </div>
          {themesOpen && <Themes data={data} onShow={showCards} />}
        </div>
      </div>
    </CanvasCtx.Provider>
  )
}

/** Which line means what, for the kinds of links on this canvas. Hover a line for the reason. */
function Legend({ relations }: { relations: CanvasLink["relation"][] }) {
  return (
    <div className="pointer-events-none absolute top-3 right-3 z-10 flex flex-col gap-1 rounded-lg border bg-background/90 px-2.5 py-2 text-[11px] text-muted-foreground max-lg:hidden">
      {relations.map((r) => (
        <div key={r} className="flex items-center gap-2">
          <svg width="22" height="4" aria-hidden>
            <line x1="0" y1="2" x2="22" y2="2" stroke={RELATION_STYLE[r].stroke} strokeWidth="2" strokeDasharray={RELATION_STYLE[r].dash} />
          </svg>
          {RELATION_STYLE[r].label}
        </div>
      ))}
    </div>
  )
}

/** Where new thoughts are written. The row above it sets the card's kind; Auto leaves it to the AI. */
function Composer({ onAdd }: { onAdd: (text: string, kind?: CardKind) => void }) {
  const [text, setText] = useState("")
  const [kind, setKind] = useState<CardKind | "auto">("auto")
  const input = useRef<HTMLTextAreaElement>(null)
  const submit = () => {
    if (!text.trim()) return
    onAdd(text, kind === "auto" ? undefined : kind)
    setText("")
    setKind("auto")
  }
  const pill = "h-6 gap-1.5 rounded-full px-2.5 text-xs font-normal text-muted-foreground data-[state=on]:bg-secondary data-[state=on]:text-foreground"
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl rounded-xl border bg-background shadow-lg">
        <ToggleGroup
          type="single"
          size="sm"
          spacing={1}
          value={kind}
          onValueChange={(v) => {
            setKind((v || "auto") as CardKind | "auto")
            input.current?.focus()
          }}
          className="w-full flex-wrap px-2 pt-2"
          aria-label="Kind of thought"
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="auto" className={pill}>
                Auto
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Let the AI sort it</TooltipContent>
          </Tooltip>
          {KINDS.filter((k) => k.id !== "note").map((k) => (
            <ToggleGroupItem key={k.id} value={k.id} className={pill}>
              <span className="size-1.5 rounded-full" style={{ background: k.color }} />
              {k.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Textarea
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder={kind === "auto" ? "Write a thought and press Enter" : `Write a ${KINDS.find((k) => k.id === kind)?.label.toLowerCase()} and press Enter`}
          className="max-h-40 min-h-10 resize-none border-0 bg-transparent px-3.5 py-2.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="New card"
        />
      </div>
    </div>
  )
}

function Themes({ data, onShow }: { data: CanvasData | null; onShow: (ids: string[]) => void }) {
  const s = data?.synthesis
  const text = (id: string) => data?.cards.find((c) => c.id === id)?.text ?? ""
  return (
    <aside className="w-72 shrink-0 border-l max-md:hidden">
      <ScrollArea className="h-full">
        <div className="flex flex-col gap-5 p-4">
          <div>
            <h2 className="text-sm font-medium">Emerging themes</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Read from your own cards. They're prompts to think with, not conclusions.
            </p>
          </div>
          {!s?.themes.length ? (
            <p className="text-sm text-muted-foreground">They'll show up once you have a few cards.</p>
          ) : (
            s.themes.map((t, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <h3 className="text-sm font-medium">{t.title}</h3>
                <p className="text-sm text-muted-foreground">{t.insight}</p>
                {t.cards.length > 0 && (
                  <button
                    className="w-fit text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => onShow(t.cards)}
                    title={t.cards.map(text).join("\n")}
                  >
                    Show {t.cards.length} card{t.cards.length > 1 ? "s" : ""}
                  </button>
                )}
              </div>
            ))
          )}
          {!!s?.questions.length && (
            <div className="flex flex-col gap-1.5 border-t pt-4">
              <h2 className="text-sm font-medium">Still open</h2>
              <ul className="flex list-disc flex-col gap-1 pl-4 text-sm text-muted-foreground">
                {s.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}

const nodeTypes = { card: CardNodeView, shape: ShapeNodeView }
const edgeTypes = { link: LinkEdgeView, arrow: ArrowEdgeView }
