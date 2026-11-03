import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { writeFileAtomic } from "./paths.ts"
import { getProject, projectDir, readNote } from "./projects.ts"
import * as latex from "./latex.ts"
import { countLatex, countMarkdown } from "./wordcount.ts"

/**
 * The student's thesis plan: chapters (each can point at a note or a LaTeX file, whose words are
 * counted), word goals, due dates and supervisor milestones. Stored in `<project>/thesis.json`,
 * with a daily log of the total word count so progress can be shown over time.
 */

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const id = z.string().regex(/^[\w-]{1,40}$/)

export const Plan = z.object({
  submission: date.optional(),
  goal: z.number().int().min(0).max(1_000_000).optional(),
  chapters: z
    .array(
      z.object({
        id,
        title: z.string().trim().min(1).max(200),
        doc: z.object({ kind: z.enum(["note", "latex"]), path: z.string().max(600) }).optional(),
        goal: z.number().int().min(0).max(1_000_000).optional(),
        due: date.optional(),
        status: z.enum(["todo", "drafting", "revising", "done"]).default("todo"),
      }),
    )
    .max(100)
    .default([]),
  milestones: z
    .array(z.object({ id, title: z.string().trim().min(1).max(300), due: date.optional(), done: z.boolean().default(false) }))
    .max(200)
    .default([]),
})
export type Plan = z.infer<typeof Plan>

const Stored = Plan.extend({ log: z.record(date, z.number().int().min(0)).default({}) })
type Stored = z.infer<typeof Stored>

const file = (projectId: string) => path.join(projectDir(projectId), "thesis.json")

async function load(projectId: string): Promise<Stored> {
  await getProject(projectId)
  const raw = await fs.readFile(file(projectId), "utf8").catch(() => "{}")
  try {
    return Stored.parse(JSON.parse(raw))
  } catch {
    return Stored.parse({})
  }
}
const save = (projectId: string, s: Stored) => writeFileAtomic(file(projectId), JSON.stringify(s, null, 2) + "\n")

/** Today's date where the student is (the server runs on their computer). */
export function localDay(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function wordsIn(projectId: string, doc: NonNullable<Plan["chapters"][number]["doc"]>) {
  try {
    if (doc.kind === "note") return countMarkdown(await readNote(projectId, doc.path))
    return countLatex(await latex.readFile(projectId, doc.path))
  } catch {
    return null
  }
}

export interface ThesisState {
  plan: Plan
  /** Chapter id -> words in its linked file; null when the file is missing. */
  words: Record<string, number | null>
  total: number
  today: number
  week: number
}

export async function state(projectId: string): Promise<ThesisState> {
  const s = await load(projectId)
  const words: Record<string, number | null> = {}
  // Two chapters can share a file (say, one LaTeX file); count it once in the total.
  const counted = new Map<string, number>()
  for (const ch of s.chapters) {
    if (!ch.doc) continue
    const key = `${ch.doc.kind}:${ch.doc.path}`
    const n = counted.has(key) ? counted.get(key)! : await wordsIn(projectId, ch.doc)
    words[ch.id] = n
    if (n !== null) counted.set(key, n)
  }
  const total = [...counted.values()].reduce((a, b) => a + b, 0)

  const today = localDay()
  const days = Object.keys(s.log).sort()
  const before = (day: string) => {
    const d = days.filter((x) => x < day).pop()
    return d ? s.log[d] : undefined
  }
  const weekAgo = localDay(new Date(Date.now() - 7 * 86400_000))
  const startOfToday = before(today)
  const startOfWeek = before(weekAgo) ?? (days[0] && days[0] < today ? s.log[days[0]] : undefined)
  if (s.chapters.length && s.log[today] !== total) {
    s.log[today] = total
    // A year and a bit is plenty.
    for (const d of Object.keys(s.log).sort().slice(0, -400)) delete s.log[d]
    await save(projectId, s)
  }
  const { log: _log, ...plan } = s
  return {
    plan,
    words,
    total,
    today: startOfToday === undefined ? 0 : total - startOfToday,
    week: startOfWeek === undefined ? 0 : total - startOfWeek,
  }
}

export async function update(projectId: string, value: unknown) {
  const s = await load(projectId)
  const plan = Plan.parse(value)
  await save(projectId, { ...plan, log: s.log })
  return state(projectId)
}

/** Keep chapter links when a note is renamed. */
export async function renameNote(projectId: string, from: string, to: string) {
  const s = await load(projectId)
  let changed = false
  for (const ch of s.chapters)
    if (ch.doc?.kind === "note" && ch.doc.path === from) {
      ch.doc.path = to
      changed = true
    }
  if (changed) await save(projectId, s)
}

/** A short summary for the mentor, so it knows what the student is working toward. */
export async function brief(projectId: string): Promise<string | null> {
  const s = await load(projectId).catch(() => null)
  if (!s || (!s.chapters.length && !s.milestones.length && !s.submission)) return null
  const st = await state(projectId)
  const lines: string[] = []
  if (s.submission) lines.push(`Submission date: ${s.submission} (today is ${localDay()}).`)
  if (s.goal) lines.push(`Word goal: ${s.goal} (${st.total} written so far).`)
  for (const ch of s.chapters) {
    const w = st.words[ch.id]
    lines.push(
      `- ${ch.title}: ${ch.status}${w != null ? `, ${w}${ch.goal ? `/${ch.goal}` : ""} words` : ch.goal ? `, goal ${ch.goal} words` : ""}${ch.due ? `, due ${ch.due}` : ""}`,
    )
  }
  const open = s.milestones.filter((m) => !m.done)
  if (open.length) lines.push(`Open supervisor milestones: ${open.map((m) => `${m.title}${m.due ? ` (${m.due})` : ""}`).join("; ")}.`)
  return lines.join("\n")
}
