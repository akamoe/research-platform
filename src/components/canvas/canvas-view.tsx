import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getStraightPath,
  useInternalNode,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type InternalNode,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/base.css"
import { BookMarkedIcon, LoaderCircleIcon, MessageSquareIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type CanvasCard, type CanvasData, type CanvasLink, type CardKind } from "@/lib/api"
import { navigate } from "@/lib/router"
import { cn } from "@/lib/utils"

const KINDS: { id: CardKind; label: string; color: string }[] = [
  { id: "note", label: "note", color: "var(--muted-foreground)" },
  { id: "question", label: "question", color: "oklch(0.72 0.15 75)" },
  { id: "claim", label: "claim", color: "oklch(0.6 0.15 250)" },
  { id: "evidence", label: "evidence", color: "oklch(0.62 0.14 155)" },
  { id: "idea", label: "idea", color: "oklch(0.6 0.17 300)" },
  { id: "quote", label: "quote", color: "oklch(0.55 0.03 60)" },
  { id: "definition", label: "definition", color: "oklch(0.62 0.1 200)" },
  { id: "task", label: "task", color: "oklch(0.66 0.16 45)" },
  { id: "source", label: "source", color: "oklch(0.55 0.02 260)" },
]
const kindOf = (k: CardKind) => KINDS.find((x) => x.id === k) ?? KINDS[0]

const RELATION_STYLE: Record<CanvasLink["relation"], { stroke: string; dash?: string; label: string }> = {
  contradicts: { stroke: "var(--destructive)", dash: "6 4", label: "contradicts" },
  supports: { stroke: "oklch(0.62 0.14 155)", label: "supports" },
  answers: { stroke: "oklch(0.6 0.15 250)", label: "answers" },
  "example-of": { stroke: "oklch(0.6 0.17 300)", label: "example of" },
  related: { stroke: "var(--muted-foreground)", label: "related" },
}

const CARD_W = 240
const CARD_H = 120

type CardNode = Node<{ card: CanvasCard }, "card">
type LinkEdge = Edge<{ link: CanvasLink }, "link">

interface Ctx {
  projectId: string
  reading: boolean
  focus: Set<string>
  edit: (id: string, text: string) => void
  setKind: (id: string, kind: CardKind) => void
}
const CanvasCtx = createContext<Ctx | null>(null)

interface Props {
  projectId: string
  chatOpen: boolean
  onToggleChat: () => void
}

export function CanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  )
}

function CanvasInner({ projectId, chatOpen, onToggleChat }: Props) {
  const [data, setData] = useState<CanvasData | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<CardNode>([])
  const [reading, setReading] = useState(false)
  const [aiOff, setAiOff] = useState<string | null>(null)
  const [themesOpen, setThemesOpen] = useState(() => localStorage.getItem("rp-canvas-themes") !== "0")
  const [focus, setFocus] = useState<Set<string>>(new Set())
  const flow = useReactFlow<CardNode, LinkEdge>()
  const wrapper = useRef<HTMLDivElement>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    api.canvas(projectId).then(setData, (e) => toast.error(e.message))
  }, [projectId])

  // Cards -> React Flow nodes, keeping a card where it is while it's being dragged.
  useEffect(() => {
    if (!data) return
    setNodes((prev) =>
      data.cards.map((card) => {
        const old = prev.find((n) => n.id === card.id)
        return {
          ...(old ?? {}),
          id: card.id,
          type: "card" as const,
          position: old?.dragging ? old.position : { x: card.x, y: card.y },
          data: { card },
        }
      }),
    )
  }, [data, setNodes])

  const edges = useMemo<LinkEdge[]>(
    () =>
      (data?.links ?? []).map((link) => ({
        id: link.id,
        source: link.from,
        target: link.to,
        type: "link" as const,
        data: { link },
      })),
    [data],
  )

  // The AI reads new and edited cards a moment after the student stops writing.
  const think = useCallback(async () => {
    setReading(true)
    try {
      const next = await api.think(projectId)
      setData(next)
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

  /** A free spot near the middle of what the student is looking at. */
  const freeSpot = () => {
    const box = wrapper.current?.getBoundingClientRect()
    const center = box
      ? flow.screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 - 60 })
      : { x: 0, y: 0 }
    const cards = data?.cards ?? []
    const taken = (x: number, y: number) =>
      cards.some((c) => Math.abs(c.x - x) < CARD_W + 16 && Math.abs(c.y - y) < CARD_H + 16)
    const sx = center.x - CARD_W / 2
    const sy = center.y - CARD_H / 2
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

  const add = async (text: string) => {
    try {
      const card = await api.addCard(projectId, { text, ...freeSpot() })
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
    }),
    [projectId, reading, focus, scheduleThink],
  )

  const remove = async (ids: string[]) => {
    for (const id of ids) {
      try {
        await api.removeCard(projectId, id)
        setData((d) =>
          d ? { ...d, cards: d.cards.filter((c) => c.id !== id), links: d.links.filter((l) => l.from !== id && l.to !== id) } : d,
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
              <ReactFlow<CardNode, LinkEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onNodeDragStop={(_, node) => {
                  const x = Math.round(node.position.x)
                  const y = Math.round(node.position.y)
                  setData((d) => (d ? { ...d, cards: d.cards.map((c) => (c.id === node.id ? { ...c, x, y } : c)) } : d))
                  api.updateCard(projectId, node.id, { x, y }).catch(() => {})
                }}
                onNodesDelete={(ns) => remove(ns.map((n) => n.id))}
                deleteKeyCode={["Delete", "Backspace"]}
                nodesConnectable={false}
                fitView
                fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
                className="bg-muted/40"
              >
                <Background gap={24} size={1} color="var(--border)" />
                <Controls showInteractive={false} position="bottom-left" className="overflow-hidden rounded-md border bg-background shadow-sm [&_button]:border-b [&_button]:bg-background [&_button]:fill-foreground [&_button:hover]:bg-muted" />
              </ReactFlow>
            )}
            {data && data.cards.length === 0 && (
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
    <div className="pointer-events-none absolute right-3 bottom-4 flex flex-col gap-1 rounded-md border bg-background/90 px-2.5 py-2 text-[11px] text-muted-foreground max-lg:hidden">
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

function Composer({ onAdd }: { onAdd: (text: string) => void }) {
  const [text, setText] = useState("")
  const submit = () => {
    if (!text.trim()) return
    onAdd(text)
    setText("")
  }
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-xl rounded-xl border bg-background p-1.5 shadow-lg">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={1}
          placeholder="Write a thought and press Enter. Add #question, #claim, #evidence or #idea to set its kind."
          className="max-h-40 min-h-9 resize-none border-0 bg-transparent px-2 py-1.5 shadow-none focus-visible:ring-0"
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

const CardNodeView = memo(function CardNodeView({ data, selected }: NodeProps<CardNode>) {
  const ctx = useContext(CanvasCtx)!
  const { card } = data
  const [editing, setEditing] = useState<string | null>(null)
  const k = kindOf(card.kind)
  const unread = !card.analyzedAt || card.updatedAt > card.analyzedAt
  const finish = () => {
    if (editing !== null && editing.trim() && editing.trim() !== card.text) ctx.edit(card.id, editing)
    setEditing(null)
  }
  return (
    <div
      className={cn(
        "group flex w-[240px] flex-col gap-1.5 rounded-lg border bg-card p-3 text-card-foreground shadow-sm transition-shadow",
        selected && "ring-2 ring-ring",
        ctx.focus.has(card.id) && "ring-2 ring-amber-400",
      )}
      style={{ borderTop: `3px solid ${k.color}` }}
      onDoubleClick={() => editing === null && setEditing(card.text)}
    >
      <Handle type="target" position={Position.Top} className="!pointer-events-none !opacity-0" isConnectable={false} />
      <Handle type="source" position={Position.Bottom} className="!pointer-events-none !opacity-0" isConnectable={false} />
      <div className="flex items-center gap-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="nodrag text-[11px] font-medium tracking-wide uppercase" style={{ color: k.color }} title="Change kind">
              {k.label}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {KINDS.map((x) => (
              <DropdownMenuItem key={x.id} onSelect={() => ctx.setKind(card.id, x.id)}>
                <span className="size-2 rounded-full" style={{ background: x.color }} />
                {x.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {unread && (
          <span
            className={cn("ml-auto size-1.5 rounded-full bg-muted-foreground/40", ctx.reading && "animate-pulse bg-muted-foreground")}
            title="Not read by the AI yet"
          />
        )}
      </div>
      {editing !== null ? (
        <Textarea
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={finish}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              finish()
            }
            if (e.key === "Escape") setEditing(null)
            e.stopPropagation()
          }}
          className="nodrag nowheel min-h-16 resize-none p-1.5 text-sm"
        />
      ) : (
        <p className="text-sm leading-snug whitespace-pre-wrap">{card.text}</p>
      )}
      {card.note && editing === null && (
        <p className="flex gap-1 text-xs leading-snug text-muted-foreground">
          <SparklesIcon className="mt-0.5 size-3 shrink-0" />
          <span>{card.note}</span>
        </p>
      )}
      {(!!card.tags?.length || !!card.pages?.length) && editing === null && (
        <div className="flex flex-wrap items-center gap-1">
          {card.tags?.map((t) => (
            <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
              {t}
            </span>
          ))}
          {card.pages?.map((p) => (
            <button
              key={p}
              className="nodrag flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Open in the knowledge base"
              onClick={() => navigate({ name: "project", projectId: ctx.projectId, view: "knowledge", page: p })}
            >
              <BookMarkedIcon className="size-3" />
              {p.split("/").pop()?.replace(/-/g, " ")}
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

/** Where the line from a node's centre towards another point leaves the node's box. */
function borderPoint(node: InternalNode, toward: { x: number; y: number }) {
  const w = node.measured.width ?? CARD_W
  const h = node.measured.height ?? CARD_H
  const cx = node.internals.positionAbsolute.x + w / 2
  const cy = node.internals.positionAbsolute.y + h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (!dx && !dy) return { x: cx, y: cy }
  const scale = Math.min(Math.abs(w / 2 / (dx || 1e-9)), Math.abs(h / 2 / (dy || 1e-9)))
  return { x: cx + dx * scale, y: cy + dy * scale }
}

function center(node: InternalNode) {
  return {
    x: node.internals.positionAbsolute.x + (node.measured.width ?? CARD_W) / 2,
    y: node.internals.positionAbsolute.y + (node.measured.height ?? CARD_H) / 2,
  }
}

function LinkEdgeView({ id, source, target, data }: EdgeProps<LinkEdge>) {
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

const nodeTypes = { card: CardNodeView }
const edgeTypes = { link: LinkEdgeView }
