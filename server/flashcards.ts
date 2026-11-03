import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { z } from "zod"
import { completeJson } from "./ai.ts"
import { HttpError, TRASH_DIR, writeFileAtomic } from "./paths.ts"
import { getProject, projectDir } from "./projects.ts"
import * as sources from "./sources.ts"

/**
 * Flashcards for studying what the student highlighted. A card's answer is the highlight itself
 * (the source's words, with its page); the question is the student's, or one the AI writes for the
 * highlight. Reviews are spaced out (a simple SM-2): cards you know come back later and later.
 * Stored in `<project>/flashcards.json`.
 */

export type Rating = "again" | "hard" | "good" | "easy"
export interface Card {
  id: string
  front: string
  back: string
  sourceId?: string
  highlightId?: string
  page?: number
  by: "student" | "ai"
  createdAt: string
  /** When to show it next. */
  due: string
  /** Days until the next review after a correct answer. */
  interval: number
  ease: number
  reps: number
  lapses: number
  suspended?: boolean
  lastReview?: string
}

const file = (projectId: string) => path.join(projectDir(projectId), "flashcards.json")

export async function list(projectId: string): Promise<Card[]> {
  await getProject(projectId)
  try {
    const raw = JSON.parse(await fs.readFile(file(projectId), "utf8"))
    return Array.isArray(raw) ? raw : []
  } catch {
    return []
  }
}
const write = (projectId: string, cards: Card[]) => writeFileAtomic(file(projectId), JSON.stringify(cards, null, 2))

const queues = new Map<string, Promise<unknown>>()
function locked<T>(projectId: string, fn: () => Promise<T>) {
  const next = (queues.get(projectId) ?? Promise.resolve()).then(fn, fn)
  queues.set(projectId, next.catch(() => {}))
  return next
}

const newCard = (c: Pick<Card, "front" | "back" | "by"> & Partial<Card>): Card => ({
  id: crypto.randomBytes(5).toString("hex"),
  createdAt: new Date().toISOString(),
  due: new Date().toISOString(),
  interval: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
  ...c,
})

export const CardInput = z.object({
  front: z.string().trim().min(1).max(2000),
  back: z.string().trim().min(1).max(4000),
  sourceId: z.string().regex(/^[\w-]+$/).optional(),
  highlightId: z.string().max(80).optional(),
  page: z.number().int().min(0).optional(),
})

export function create(projectId: string, input: z.infer<typeof CardInput>) {
  return locked(projectId, async () => {
    const cards = await list(projectId)
    const card = newCard({ ...input, by: "student" })
    cards.push(card)
    await write(projectId, cards)
    return card
  })
}

export function update(projectId: string, id: string, patch: { front?: string; back?: string; suspended?: boolean }) {
  return locked(projectId, async () => {
    const cards = await list(projectId)
    const c = cards.find((x) => x.id === id)
    if (!c) throw new HttpError(404, "Card not found")
    if (patch.front !== undefined) {
      c.front = patch.front.trim()
      c.by = "student"
    }
    if (patch.back !== undefined) c.back = patch.back.trim()
    if (patch.suspended !== undefined) c.suspended = patch.suspended || undefined
    await write(projectId, cards)
    return c
  })
}

/** Into the trash as its own file, like references. */
export function remove(projectId: string, id: string) {
  return locked(projectId, async () => {
    const cards = await list(projectId)
    const c = cards.find((x) => x.id === id)
    if (!c) throw new HttpError(404, "Card not found")
    await fs.mkdir(TRASH_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await fs.writeFile(path.join(TRASH_DIR, `${stamp}-${projectId}-flashcard-${id}.json`), JSON.stringify(c, null, 2))
    await write(projectId, cards.filter((x) => x.id !== id))
  })
}

const DAY = 24 * 3600_000
/** The next interval in days for each answer, so the buttons can show it. */
export function preview(c: Card): Record<Rating, number> {
  const good = c.reps === 0 ? 2 : c.reps === 1 ? 4 : Math.round(c.interval * c.ease)
  return {
    again: 0,
    hard: Math.max(1, Math.round(Math.max(1, c.interval) * 1.2)),
    good: Math.max(good, c.interval + 1),
    easy: Math.max(c.reps === 0 ? 4 : Math.round(c.interval * c.ease * 1.3), Math.max(good, c.interval + 1) + 1),
  }
}

export function review(projectId: string, id: string, rating: Rating) {
  return locked(projectId, async () => {
    const cards = await list(projectId)
    const c = cards.find((x) => x.id === id)
    if (!c) throw new HttpError(404, "Card not found")
    const days = preview(c)[rating]
    const now = Date.now()
    if (rating === "again") {
      c.lapses++
      c.reps = 0
      c.interval = 0
      c.ease = Math.max(1.3, c.ease - 0.2)
      // Again in ten minutes, in this session.
      c.due = new Date(now + 10 * 60_000).toISOString()
    } else {
      c.reps++
      c.interval = days
      if (rating === "hard") c.ease = Math.max(1.3, c.ease - 0.15)
      if (rating === "easy") c.ease += 0.15
      c.due = new Date(now + days * DAY).toISOString()
    }
    c.lastReview = new Date(now).toISOString()
    await write(projectId, cards)
    return c
  })
}

const SYSTEM = `You help a student study what they highlighted in their reading. For each highlight, write one short question that the highlight answers, so the student can test their recall. The answer will be the highlight itself, so the question must not give the answer away.

Rules:
- One question per highlight, at most 25 words, in the same language as the highlight.
- Ask about the idea, finding or definition, not the wording ("What did Walker et al. find about…", "How is … defined?", "Why does …?").
- If a highlight is too short or vague to make a useful question (a heading, a name alone, a fragment), skip it.

Reply with only JSON: {"cards": [{"h": "h1", "front": "the question"}]}`

const Reply = z.object({ cards: z.array(z.object({ h: z.string(), front: z.string().min(3).max(400) })) })

/** Cards for the source's text highlights that don't have one yet. */
export async function generate(projectId: string, sourceId: string) {
  const source = await sources.getSource(projectId, sourceId)
  const existing = await list(projectId)
  const used = new Set(existing.filter((c) => c.sourceId === sourceId).map((c) => c.highlightId))
  const highlights = (await sources.listHighlights(projectId, sourceId)).filter((h) => h.text && h.text.trim().split(/\s+/).length >= 4 && !used.has(h.id))
  if (!highlights.length) return { added: [] as Card[], skipped: 0 }
  const batch = highlights.slice(0, 60).map((h, i) => ({ tag: `h${i + 1}`, h }))
  const { data } = await completeJson(
    SYSTEM,
    `Source: ${source.title}\n\nHighlights:\n${batch.map((b) => `[${b.tag}] ${b.h.text!.trim().slice(0, 1200)}`).join("\n")}`,
    Reply,
  )
  const byTag = new Map(batch.map((b) => [b.tag, b.h]))
  const fresh: Card[] = []
  for (const c of data.cards) {
    const h = byTag.get(c.h.replace(/[[\]]/g, ""))
    if (!h || fresh.some((x) => x.highlightId === h.id)) continue
    fresh.push(newCard({ front: c.front.trim(), back: h.text!.trim(), sourceId, highlightId: h.id, page: h.pageIndex + 1, by: "ai" }))
  }
  return locked(projectId, async () => {
    const cards = await list(projectId)
    const have = new Set(cards.map((c) => `${c.sourceId}/${c.highlightId}`))
    const added = fresh.filter((c) => !have.has(`${c.sourceId}/${c.highlightId}`))
    await write(projectId, [...cards, ...added])
    return { added, skipped: batch.length - added.length }
  })
}
