import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { z } from "zod"
import { completeJson } from "./ai.ts"
import { HttpError, PROJECTS_DIR } from "./paths.ts"
import { getProject } from "./projects.ts"
import { listPages } from "./knowledge.ts"

/**
 * The notes canvas (nodepad-style): the student writes short thoughts freely; the AI
 * quietly classifies them, adds a one-line note, links related ones, flags
 * contradictions and proposes emerging themes. Stored as one JSON file per project.
 */

export const KINDS = ["note", "question", "claim", "evidence", "idea", "quote", "definition", "task", "source"] as const
export type CardKind = (typeof KINDS)[number]
export const RELATIONS = ["supports", "contradicts", "related", "answers", "example-of"] as const

export interface Card {
  id: string
  text: string
  kind: CardKind
  /** Who set the kind: the student (with #kind) or the AI. */
  kindBy?: "student" | "ai"
  x: number
  y: number
  createdAt: string
  updatedAt: string
  /** The AI's one-line annotation. */
  note?: string
  tags?: string[]
  /** Knowledge-base pages this card relates to. */
  pages?: string[]
  analyzedAt?: string
}

export interface Link {
  id: string
  from: string
  to: string
  relation: (typeof RELATIONS)[number]
  why: string
}

export interface Synthesis {
  at: string
  themes: { title: string; insight: string; cards: string[] }[]
  questions: string[]
}

/** Things the student draws: frames, ellipses, labels, pen strokes. The AI ignores them. */
export interface Shape {
  id: string
  type: "rect" | "ellipse" | "text" | "draw" | "arrow"
  x: number
  y: number
  w: number
  h: number
  color: string
  text?: string
  /** Pen strokes: points scaled to 0..1 inside the box, so resizing stretches them. */
  points?: [number, number][]
}

/** An arrow the student drew between two cards or shapes. */
export interface Arrow {
  id: string
  from: string
  to: string
  color: string
}

export interface Canvas {
  cards: Card[]
  links: Link[]
  shapes?: Shape[]
  arrows?: Arrow[]
  synthesis?: Synthesis
  /** Removed cards are kept here for a while, never just dropped. */
  removed?: Card[]
}

function file(projectId: string) {
  if (!/^[\w-]+$/.test(projectId)) throw new HttpError(400, "Invalid project id")
  return path.join(PROJECTS_DIR, projectId, "canvas.json")
}

const now = () => new Date().toISOString()

export async function readCanvas(projectId: string): Promise<Canvas> {
  await getProject(projectId)
  try {
    const c = JSON.parse(await fs.readFile(file(projectId), "utf8")) as Canvas
    return {
      cards: c.cards ?? [],
      links: c.links ?? [],
      shapes: c.shapes ?? [],
      arrows: c.arrows ?? [],
      synthesis: c.synthesis,
      removed: c.removed ?? [],
    }
  } catch {
    return { cards: [], links: [], shapes: [], arrows: [], removed: [] }
  }
}

async function writeCanvas(projectId: string, c: Canvas) {
  const tmp = `${file(projectId)}.tmp`
  await fs.writeFile(tmp, JSON.stringify(c, null, 2))
  await fs.rename(tmp, file(projectId))
}

// Writes for one project happen one at a time.
const locks = new Map<string, Promise<unknown>>()
function locked<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve()
  const next = prev.catch(() => {}).then(fn)
  locks.set(projectId, next)
  return next
}

/** "#question Does X cause Y?" or "Does X cause Y? #question" sets the kind. */
export function parseKind(text: string): { text: string; kind?: CardKind } {
  const m = /(?:^|\s)#([a-z-]+)\s*$/i.exec(text) ?? /^#([a-z-]+)\s+/i.exec(text)
  if (m && (KINDS as readonly string[]).includes(m[1].toLowerCase())) {
    return { text: text.replace(m[0], " ").trim(), kind: m[1].toLowerCase() as CardKind }
  }
  return { text: text.trim() }
}

export function addCard(projectId: string, input: { text: string; x: number; y: number; kind?: CardKind }) {
  return locked(projectId, async () => {
    const c = await readCanvas(projectId)
    const parsed = parseKind(input.text)
    const text = parsed.text
    const kind = input.kind ?? parsed.kind
    if (!text) throw new HttpError(400, "Write something first")
    const t = now()
    const card: Card = {
      id: crypto.randomBytes(4).toString("hex"),
      text,
      kind: kind ?? "note",
      kindBy: kind ? "student" : undefined,
      x: input.x,
      y: input.y,
      createdAt: t,
      updatedAt: t,
    }
    c.cards.push(card)
    await writeCanvas(projectId, c)
    return card
  })
}

export function updateCard(projectId: string, cardId: string, patch: { text?: string; x?: number; y?: number; kind?: CardKind }) {
  return locked(projectId, async () => {
    const c = await readCanvas(projectId)
    const card = c.cards.find((x) => x.id === cardId)
    if (!card) throw new HttpError(404, "Card not found")
    if (patch.text !== undefined) {
      const parsed = parseKind(patch.text)
      if (!parsed.text) throw new HttpError(400, "A card can't be empty")
      if (parsed.text !== card.text) {
        card.text = parsed.text
        card.updatedAt = now()
        // Its old links and note were about the old text.
        c.links = c.links.filter((l) => l.from !== cardId && l.to !== cardId)
        card.note = undefined
      }
      if (parsed.kind) {
        card.kind = parsed.kind
        card.kindBy = "student"
      }
    }
    if (patch.kind) {
      card.kind = patch.kind
      card.kindBy = "student"
    }
    if (patch.x !== undefined) card.x = patch.x
    if (patch.y !== undefined) card.y = patch.y
    await writeCanvas(projectId, c)
    return card
  })
}

export function removeCard(projectId: string, cardId: string) {
  return locked(projectId, async () => {
    const c = await readCanvas(projectId)
    const card = c.cards.find((x) => x.id === cardId)
    if (!card) throw new HttpError(404, "Card not found")
    c.cards = c.cards.filter((x) => x.id !== cardId)
    c.links = c.links.filter((l) => l.from !== cardId && l.to !== cardId)
    c.arrows = (c.arrows ?? []).filter((a) => a.from !== cardId && a.to !== cardId)
    c.removed = [{ ...card, updatedAt: now() }, ...(c.removed ?? [])].slice(0, 200)
    if (c.synthesis) c.synthesis.themes = c.synthesis.themes.map((t) => ({ ...t, cards: t.cards.filter((id) => id !== cardId) }))
    await writeCanvas(projectId, c)
  })
}

export function restoreCard(projectId: string, cardId: string) {
  return locked(projectId, async () => {
    const c = await readCanvas(projectId)
    const card = c.removed?.find((x) => x.id === cardId)
    if (!card) throw new HttpError(404, "Card not found")
    c.removed = c.removed!.filter((x) => x.id !== cardId)
    c.cards.push({ ...card, analyzedAt: undefined })
    await writeCanvas(projectId, c)
    return card
  })
}

/** The client sends the whole drawing layer; it's small, and this keeps undo simple. */
export function saveDrawing(projectId: string, drawing: { shapes: Shape[]; arrows: Arrow[] }) {
  return locked(projectId, async () => {
    const c = await readCanvas(projectId)
    const ids = new Set([...c.cards.map((x) => x.id), ...drawing.shapes.map((x) => x.id)])
    c.shapes = drawing.shapes
    c.arrows = drawing.arrows.filter((a) => ids.has(a.from) && ids.has(a.to) && a.from !== a.to)
    await writeCanvas(projectId, c)
    return { shapes: c.shapes, arrows: c.arrows }
  })
}

// ---------- the AI reads the canvas ----------

const READER = `You quietly read a student's research notes on a canvas and help them see what they have. You are not writing their paper and you never write prose for it.

For each new card:
- kind: one of ${KINDS.join(", ")} (keep the student's kind if they set one).
- note: at most 18 words, for the student only. Add context, a caveat, a definition, or a sharp question. Don't restate the card and don't praise.
- tags: 1-3 short lowercase topic tags, reusing existing ones where they fit.
- pages: ids of knowledge-base pages the card relates to (only from the list given).

Links between any cards (new or old), only where the relationship is real:
- supports, contradicts, related, answers (a card answers a question card), example-of.
- "why": at most 14 words. Contradictions matter most: point out real tension between cards.

Synthesis (only if there are at least 3 cards): 1-4 emerging themes drawn ONLY from the student's own cards. Each theme: a short title, an "insight" of at most 25 words phrased as an observation or a question for the student (never a thesis statement written for their paper), and the card ids behind it. Then 1-3 open questions the cards leave unanswered.

Never invent facts, studies or citations. Reply with JSON only.`

const ReadResult = z.object({
  cards: z
    .array(
      z.object({
        id: z.string(),
        kind: z.string().optional(),
        note: z.string().optional(),
        tags: z.array(z.string()).optional(),
        pages: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  links: z
    .array(z.object({ from: z.string(), to: z.string(), relation: z.string(), why: z.string().default("") }))
    .default([]),
  synthesis: z
    .object({
      themes: z
        .array(z.object({ title: z.string(), insight: z.string().default(""), cards: z.array(z.string()).default([]) }))
        .default([]),
      questions: z.array(z.string()).default([]),
    })
    .nullable()
    .optional(),
})

const thinking = new Set<string>()

export function isThinking(projectId: string) {
  return thinking.has(projectId)
}

/** Reads cards that are new or changed since the last pass; returns the updated canvas. */
export async function think(projectId: string): Promise<Canvas> {
  if (thinking.has(projectId)) return readCanvas(projectId)
  thinking.add(projectId)
  try {
    const snapshot = await readCanvas(projectId)
    const fresh = snapshot.cards.filter((c) => !c.analyzedAt || c.updatedAt > c.analyzedAt)
    if (!fresh.length) return snapshot

    const pages = await listPages(projectId).catch(() => [])
    const fmt = (c: Card) => `- [${c.id}] (${c.kind}${c.kindBy === "student" ? ", set by student" : ""}) ${c.text.slice(0, 600)}`
    const older = snapshot.cards.filter((c) => !fresh.includes(c))
    const prompt = `Knowledge-base pages:
${pages.map((p) => `- ${p.id}: ${p.title}`).join("\n") || "(none)"}

Existing cards:
${older.map(fmt).join("\n") || "(none)"}

Existing links:
${snapshot.links.map((l) => `- ${l.from} ${l.relation} ${l.to}`).join("\n") || "(none)"}

New or edited cards to read:
${fresh.map(fmt).join("\n")}

Return JSON:
{
  "cards": [{"id": "...", "kind": "...", "note": "...", "tags": ["..."], "pages": ["page ids"]}],
  "links": [{"from": "card id", "to": "card id", "relation": "supports|contradicts|related|answers|example-of", "why": "..."}],
  "synthesis": {"themes": [{"title": "...", "insight": "...", "cards": ["ids"]}], "questions": ["..."]}
}
"cards" covers only the new or edited cards. "links" lists only NEW links. "synthesis" covers the whole canvas.`

    const { data } = await completeJson(READER, prompt, ReadResult)

    return await locked(projectId, async () => {
      // Re-read: the student may have kept writing while the model was thinking.
      const c = await readCanvas(projectId)
      const ids = new Set(c.cards.map((x) => x.id))
      const pageIds = new Set(pages.map((p) => p.id))
      const t = now()
      for (const r of data.cards) {
        const card = c.cards.find((x) => x.id === r.id)
        const before = fresh.find((x) => x.id === r.id)
        if (!card || !before || card.updatedAt !== before.updatedAt) continue
        if (card.kindBy !== "student" && r.kind && (KINDS as readonly string[]).includes(r.kind)) {
          card.kind = r.kind as CardKind
          card.kindBy = "ai"
        }
        card.note = r.note?.trim() || undefined
        card.tags = r.tags?.map((x) => x.toLowerCase().trim()).filter(Boolean).slice(0, 3)
        card.pages = r.pages?.filter((p) => pageIds.has(p))
        card.analyzedAt = t
      }
      // Cards the model skipped still count as read, so they aren't sent forever.
      for (const f of fresh) {
        const card = c.cards.find((x) => x.id === f.id)
        if (card && card.updatedAt === f.updatedAt && !card.analyzedAt) card.analyzedAt = t
      }
      for (const l of data.links) {
        if (!ids.has(l.from) || !ids.has(l.to) || l.from === l.to) continue
        if (!(RELATIONS as readonly string[]).includes(l.relation)) continue
        if (c.links.some((x) => (x.from === l.from && x.to === l.to) || (x.from === l.to && x.to === l.from))) continue
        c.links.push({ id: crypto.randomBytes(4).toString("hex"), from: l.from, to: l.to, relation: l.relation as Link["relation"], why: l.why.trim() })
      }
      if (data.synthesis && c.cards.length >= 3) {
        c.synthesis = {
          at: t,
          themes: data.synthesis.themes
            .slice(0, 4)
            .map((th) => ({ title: th.title, insight: th.insight, cards: th.cards.filter((id) => ids.has(id)) })),
          questions: data.synthesis.questions.slice(0, 3),
        }
      }
      await writeCanvas(projectId, c)
      return c
    })
  } finally {
    thinking.delete(projectId)
  }
}
