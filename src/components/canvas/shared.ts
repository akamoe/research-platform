import { createContext } from "react"
import type { Edge, InternalNode, Node } from "@xyflow/react"
import type { CanvasArrow, CanvasCard, CanvasLink, CanvasShape, CardKind } from "@/lib/api"

export const KINDS: { id: CardKind; label: string; color: string }[] = [
  { id: "note", label: "Note", color: "var(--muted-foreground)" },
  { id: "question", label: "Question", color: "oklch(0.72 0.15 75)" },
  { id: "claim", label: "Claim", color: "oklch(0.6 0.15 250)" },
  { id: "evidence", label: "Evidence", color: "oklch(0.62 0.14 155)" },
  { id: "idea", label: "Idea", color: "oklch(0.6 0.17 300)" },
  { id: "quote", label: "Quote", color: "oklch(0.6 0.05 60)" },
  { id: "definition", label: "Definition", color: "oklch(0.62 0.1 200)" },
  { id: "task", label: "Task", color: "oklch(0.66 0.16 45)" },
  { id: "source", label: "Source", color: "oklch(0.55 0.02 260)" },
]
export const kindOf = (k: CardKind) => KINDS.find((x) => x.id === k) ?? KINDS[0]

/** Colors for shapes and arrows. Stored by id so they follow light and dark mode. */
export const COLORS: { id: string; label: string; value: string }[] = [
  { id: "default", label: "Default", value: "var(--foreground)" },
  { id: "gray", label: "Gray", value: "var(--muted-foreground)" },
  { id: "red", label: "Red", value: "oklch(0.63 0.2 25)" },
  { id: "amber", label: "Amber", value: "oklch(0.75 0.15 75)" },
  { id: "green", label: "Green", value: "oklch(0.62 0.14 155)" },
  { id: "blue", label: "Blue", value: "oklch(0.6 0.15 250)" },
  { id: "violet", label: "Violet", value: "oklch(0.6 0.17 300)" },
  { id: "pink", label: "Pink", value: "oklch(0.66 0.18 350)" },
]
export const colorOf = (id: string) => (COLORS.find((c) => c.id === id) ?? COLORS[0]).value

export const RELATION_STYLE: Record<CanvasLink["relation"], { stroke: string; dash?: string; label: string }> = {
  contradicts: { stroke: "var(--destructive)", dash: "6 4", label: "contradicts" },
  supports: { stroke: "oklch(0.62 0.14 155)", label: "supports" },
  answers: { stroke: "oklch(0.6 0.15 250)", label: "answers" },
  "example-of": { stroke: "oklch(0.6 0.17 300)", label: "example of" },
  related: { stroke: "var(--muted-foreground)", label: "related" },
}

export const CARD_W = 240
export const CARD_H = 120

export type Tool = "select" | "rect" | "ellipse" | "arrow" | "draw" | "text"

export type CardNode = Node<{ card: CanvasCard }, "card">
export type ShapeNode = Node<{ shape: CanvasShape }, "shape">
export type AnyNode = CardNode | ShapeNode
export type LinkEdge = Edge<{ link: CanvasLink }, "link">
export type ArrowEdge = Edge<{ arrow: CanvasArrow }, "arrow">
export type AnyEdge = LinkEdge | ArrowEdge

export interface Ctx {
  projectId: string
  reading: boolean
  focus: Set<string>
  pageTitle: (id: string) => string
  edit: (id: string, text: string) => void
  setKind: (id: string, kind: CardKind) => void
  editingShape: string | null
  setEditingShape: (id: string | null) => void
  updateShape: (id: string, patch: Partial<CanvasShape>) => void
  removeShapes: (ids: string[]) => void
}
export const CanvasCtx = createContext<Ctx | null>(null)

export const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 10)}`

/** Pen settings for perfect-freehand. */
export const STROKE = { size: 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5 }

/** Turn perfect-freehand's outline into an SVG path. */
export function strokePath(outline: number[][]) {
  if (outline.length < 2) return ""
  const d: (string | number)[] = ["M", outline[0][0], outline[0][1], "Q"]
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i]
    const [x1, y1] = outline[(i + 1) % outline.length]
    d.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
  }
  d.push("Z")
  return d.join(" ")
}

function size(node: InternalNode) {
  return { w: node.measured.width ?? node.width ?? CARD_W, h: node.measured.height ?? node.height ?? CARD_H }
}

export function center(node: InternalNode) {
  const { w, h } = size(node)
  return { x: node.internals.positionAbsolute.x + w / 2, y: node.internals.positionAbsolute.y + h / 2 }
}

/** Where the line from a node's centre towards another point leaves the node's box. */
export function borderPoint(node: InternalNode, toward: { x: number; y: number }, gap = 0) {
  const { w, h } = size(node)
  const c = center(node)
  const dx = toward.x - c.x
  const dy = toward.y - c.y
  if (!dx && !dy) return c
  const scale = Math.min(Math.abs((w / 2 + gap) / (dx || 1e-9)), Math.abs((h / 2 + gap) / (dy || 1e-9)))
  return { x: c.x + dx * scale, y: c.y + dy * scale }
}
