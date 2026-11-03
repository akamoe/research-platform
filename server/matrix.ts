import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { completeJson } from "./ai.ts"
import { HttpError, writeFileAtomic } from "./paths.ts"
import { getProject, projectDir } from "./projects.ts"
import * as sources from "./sources.ts"
import * as search from "./search.ts"
import * as references from "./references.ts"

/**
 * The literature review matrix: one row per source, one column per question (method, findings,
 * gaps…). The AI fills cells with short notes taken from the student's highlights (and the
 * paper's text when there are few), each pointing back to its page. The student can edit any
 * cell; the AI never overwrites what the student wrote. Stored in `<project>/matrix.json`.
 *
 * Cell text carries citation markers: `[h:<highlightId>:<page>]` for a highlight and
 * `[p:<page>]` for a passage of the paper (page 0 for sources without pages).
 */

const id = z.string().regex(/^[\w-]{1,40}$/)
const Cell = z.object({
  text: z.string().max(4000),
  by: z.enum(["ai", "student"]),
  /** The AI looked and found nothing on this. */
  none: z.boolean().optional(),
  at: z.string().optional(),
})
export type Cell = z.infer<typeof Cell>

export const Matrix = z.object({
  columns: z
    .array(z.object({ id, name: z.string().trim().min(1).max(80), hint: z.string().max(300).optional() }))
    .max(30),
  cells: z.record(z.string(), z.record(z.string(), Cell)).default({}),
  hidden: z.array(z.string()).default([]),
})
export type Matrix = z.infer<typeof Matrix>

const DEFAULT_COLUMNS: Matrix["columns"] = [
  { id: "question", name: "Research question", hint: "What the paper set out to find or test" },
  { id: "method", name: "Method", hint: "Design, approach and analysis" },
  { id: "sample", name: "Sample / data", hint: "Participants, dataset or materials, and their size" },
  { id: "findings", name: "Key findings", hint: "Main results, with numbers where given" },
  { id: "limits", name: "Limitations", hint: "Weaknesses the authors admit or that are evident" },
  { id: "gaps", name: "Gaps / future work", hint: "What is left open or suggested next" },
]

const file = (projectId: string) => path.join(projectDir(projectId), "matrix.json")

export async function read(projectId: string): Promise<Matrix> {
  await getProject(projectId)
  const raw = await fs.readFile(file(projectId), "utf8").catch(() => "")
  try {
    return Matrix.parse(JSON.parse(raw))
  } catch {
    return { columns: DEFAULT_COLUMNS, cells: {}, hidden: [] }
  }
}

// Fills for different papers run at the same time; keep their writes in order.
const queues = new Map<string, Promise<unknown>>()
function locked<T>(projectId: string, fn: () => Promise<T>) {
  const run = (queues.get(projectId) ?? Promise.resolve()).then(fn, fn)
  queues.set(projectId, run.catch(() => {}))
  return run
}

export function write(projectId: string, value: unknown) {
  return locked(projectId, async () => {
    await getProject(projectId)
    const m = Matrix.parse(value)
    const cols = new Set(m.columns.map((c) => c.id))
    for (const row of Object.values(m.cells)) for (const k of Object.keys(row)) if (!cols.has(k)) delete row[k]
    await writeFileAtomic(file(projectId), JSON.stringify(m, null, 2) + "\n")
    return m
  })
}

const SYSTEM = `You help a student fill in their literature review matrix: short notes about ONE source, one note per column.

Rules:
- Use only the numbered excerpts you are given. They are the student's own highlights ([h1], [h2]…) and, sometimes, passages from the source ([P1], [P2]…). Prefer the highlights.
- Write terse note-style fragments, at most 30 words per column, the way a student notes things on an index card. Not polished prose, and never sentences meant to be pasted into a paper.
- After each fact, put the marker of the excerpt it comes from, like [h2] or [P1]. Every fact needs a marker.
- Keep numbers, sample sizes and effect sizes exactly as written.
- If the excerpts don't say anything about a column, give an empty string for it. Don't guess and don't use outside knowledge.
- Write in the language of the excerpts.

Reply with only JSON: {"cells": {"<column id>": "note", ...}} with exactly the column ids asked for.`

const Reply = z.object({ cells: z.record(z.string(), z.string()) })

/** Fill the given columns for one source. Cells the student wrote are never touched. */
export async function fill(projectId: string, sourceId: string, columnIds?: string[], opts: { overwrite?: boolean } = {}) {
  const m = await read(projectId)
  const src = await sources.getSource(projectId, sourceId)
  const row = m.cells[sourceId] ?? {}
  const wanted = m.columns.filter(
    (c) =>
      (!columnIds || columnIds.includes(c.id)) &&
      row[c.id]?.by !== "student" &&
      (opts.overwrite || !row[c.id] || (!row[c.id].text && !row[c.id].none)),
  )
  if (!wanted.length) return { row, filled: 0 }

  const highlights = (await sources.listHighlights(projectId, sourceId).catch(() => [])).filter((h) => h.text?.trim())
  const hl = highlights.slice(0, 120).map((h, i) => ({ tag: `h${i + 1}`, marker: `[h:${h.id}:${h.pageIndex + 1}]`, page: h.pageIndex + 1, text: h.text!.trim().slice(0, 1200) }))
  const hlChars = hl.reduce((a, h) => a + h.text.length, 0)

  // With few highlights, add the passages of the source that best match each column, plus its opening.
  const passages: { tag: string; marker: string; page: number; text: string }[] = []
  if (hlChars < 3000 && src.hasText) {
    const seen = new Set<string>()
    const add = (p: { page: number; chunk: number; text: string }) => {
      const key = `${p.page}/${p.chunk}`
      if (seen.has(key) || passages.length >= 14) return
      seen.add(key)
      passages.push({ tag: `P${passages.length + 1}`, marker: `[p:${p.page}]`, page: p.page, text: p.text.slice(0, 1500) })
    }
    const all = search.sourcePassages(src, await sources.sourceText(projectId, sourceId))
    all.slice(0, 2).forEach(add)
    for (const c of wanted) {
      const hits = await search.search(projectId, `${c.name} ${c.hint ?? ""}`, { kinds: ["source"], sourceIds: [sourceId], limit: 3 })
      hits.forEach(add)
    }
  }
  if (!hl.length && !passages.length) {
    throw new HttpError(400, `“${src.title}” has no highlights or readable text to take notes from.`)
  }

  const ref = (await references.list(projectId)).find((r) => r.source === sourceId)
  const user = [
    `Source: ${src.title}${ref ? ` (${[ref.author?.[0]?.family, references.yearOf(ref)].filter(Boolean).join(", ")})` : ""}`,
    `Columns to fill:\n${wanted.map((c) => `- ${c.id}: ${c.name}${c.hint ? ` (${c.hint})` : ""}`).join("\n")}`,
    hl.length ? `The student's highlights:\n${hl.map((h) => `[${h.tag}] (p. ${h.page}) ${h.text}`).join("\n")}` : "",
    passages.length ? `Passages from the source:\n${passages.map((p) => `[${p.tag}]${p.page ? ` (p. ${p.page})` : ""} ${p.text}`).join("\n\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n")

  const { data } = await completeJson(SYSTEM, user, Reply)
  const byTag = new Map([...hl, ...passages].map((x) => [x.tag.toLowerCase(), x.marker]))
  const now = new Date().toISOString()
  return locked(projectId, async () => {
    // Re-read: the student may have edited while the model was thinking.
    const fresh = await read(projectId)
    const r = (fresh.cells[sourceId] ??= {})
    let filled = 0
    for (const c of wanted) {
      if (r[c.id]?.by === "student") continue
      const raw = (data.cells[c.id] ?? "").trim()
      // Turn [h2] / [P3] (also "[h2, P3]") into stored markers; drop markers that point nowhere.
      const text = raw
        .replace(/\[((?:\s*[hHpP]\d+\s*[,;]?)+)\]/g, (_, list: string) =>
          list
            .split(/[,;\s]+/)
            .filter(Boolean)
            .map((t) => byTag.get(t.toLowerCase()) ?? "")
            .join(""),
        )
        .replace(/\s+([.,;])/g, "$1")
        .trim()
      r[c.id] = text ? { text, by: "ai", at: now } : { text: "", by: "ai", none: true, at: now }
      if (text) filled++
    }
    await writeFileAtomic(file(projectId), JSON.stringify(fresh, null, 2) + "\n")
    return { row: r, filled }
  })
}
