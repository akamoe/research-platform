import fs from "node:fs/promises"
import path from "node:path"
import { PROJECTS_DIR, safeJoin } from "./paths.ts"
import * as projects from "./projects.ts"
import * as sources from "./sources.ts"

/**
 * Full-text search over everything in a project: the text of each paper (split into passages that
 * keep their page number) and the student's notes. Ranked with BM25, so it works offline and with
 * any model. The index is rebuilt in memory when a file changes.
 */

export interface Passage {
  kind: "source" | "note"
  /** Paper id, or note path. */
  ref: string
  title: string
  /** 1-based page for papers; 0 for notes. */
  page: number
  /** Index of this passage within its page (papers) or note. */
  chunk: number
  text: string
}

export interface Hit extends Passage {
  score: number
  snippet: string
}

const STOP = new Set(
  "a an and are as at be but by for from has have he her his i if in into is it its of on or our she so than that the their them then there these they this to was we were what when where which who will with you your not no can may also been being do does did more most other such only over about after before between both each how all any some same very would could should".split(
    " ",
  ),
)

/** Lowercase words, minus stop words, with a light English stemmer (sleeping/sleeps -> sleep). */
export function tokenize(text: string) {
  const out: string[] = []
  for (const raw of text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (raw.length < 2 || STOP.has(raw)) continue
    out.push(stem(raw))
  }
  return out
}

function stem(w: string) {
  if (w.length <= 4 || /\d/.test(w)) return w
  for (const [suf, min] of [
    ["ational", 4],
    ["ization", 4],
    ["ations", 4],
    ["ation", 4],
    ["ments", 4],
    ["ment", 4],
    ["ings", 4],
    ["ing", 4],
    ["ies", 3],
    ["ied", 3],
    ["edly", 4],
    ["ed", 4],
    ["ly", 4],
    ["es", 4],
    ["s", 4],
  ] as const) {
    if (w.endsWith(suf) && w.length - suf.length >= min) {
      const base = w.slice(0, -suf.length)
      return suf === "ies" || suf === "ied" ? `${base}y` : base
    }
  }
  return w
}

const CHUNK = 1100
const OVERLAP = 150

/** Splits text into ~1100-character passages on paragraph or sentence breaks. */
export function chunkText(text: string) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim()
  if (!clean) return []
  if (clean.length <= CHUNK * 1.3) return [clean]
  const out: string[] = []
  let start = 0
  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK)
    if (end < clean.length) {
      const window = clean.slice(start + CHUNK * 0.6, end)
      const para = window.lastIndexOf("\n\n")
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "))
      const cut = para >= 0 ? para + 2 : sentence >= 0 ? sentence + 2 : -1
      if (cut >= 0) end = start + Math.floor(CHUNK * 0.6) + cut
    }
    out.push(clean.slice(start, end).trim())
    if (end >= clean.length) break
    start = Math.max(end - OVERLAP, start + 1)
    // Start the next passage at a word boundary.
    const space = clean.indexOf(" ", start)
    if (space > 0 && space - start < 40) start = space + 1
  }
  return out.filter(Boolean)
}

/** Page-aware passages from a paper's extracted text (which marks pages as "[page N]"). */
export function sourcePassages(src: { id: string; title: string }, text: string): Passage[] {
  const out: Passage[] = []
  const parts = text.split(/\[page (\d+)\]\n?/)
  // parts: [before, "1", page1, "2", page2, ...]
  if (parts.length === 1) {
    chunkText(text).forEach((t, i) => out.push({ kind: "source", ref: src.id, title: src.title, page: 0, chunk: i, text: t }))
    return out
  }
  for (let i = 1; i < parts.length; i += 2) {
    const page = Number(parts[i])
    chunkText(parts[i + 1] ?? "").forEach((t, c) =>
      out.push({ kind: "source", ref: src.id, title: src.title, page, chunk: c, text: t }),
    )
  }
  return out
}

interface Doc extends Passage {
  terms: Map<string, number>
  len: number
}
interface Index {
  stamp: string
  docs: Doc[]
  df: Map<string, number>
  avgLen: number
}
const cache = new Map<string, Index>()

async function mtime(p: string) {
  try {
    return (await fs.stat(p)).mtimeMs
  } catch {
    return 0
  }
}

async function buildIndex(projectId: string): Promise<Index> {
  const [srcs, notes] = await Promise.all([sources.listSources(projectId), projects.listNotes(projectId)])
  const dir = safeJoin(PROJECTS_DIR, projectId)
  const stamps = await Promise.all([
    ...srcs.map(async (s) => `${s.id}:${s.title}:${await mtime(path.join(dir, "sources", `${s.id}.txt`))}`),
    ...notes.map(async (n) => `${n.path}:${await mtime(path.join(dir, "notes", n.path))}`),
  ])
  const stamp = stamps.join("|")
  const hit = cache.get(projectId)
  if (hit && hit.stamp === stamp) return hit

  const passages: Passage[] = []
  for (const s of srcs) passages.push(...sourcePassages(s, await sources.sourceText(projectId, s.id)))
  for (const n of notes) {
    let content = ""
    try {
      content = await projects.readNote(projectId, n.path)
    } catch {}
    const title = n.path.replace(/\.md$/i, "").split("/").pop() ?? n.path
    chunkText(content).forEach((t, i) => passages.push({ kind: "note", ref: n.path, title, page: 0, chunk: i, text: t }))
  }

  const df = new Map<string, number>()
  const docs: Doc[] = passages.map((p) => {
    // The title counts as part of every passage, so "Walker sleep" finds Walker's paper.
    const tokens = tokenize(`${p.title} ${p.text}`)
    const terms = new Map<string, number>()
    for (const t of tokens) terms.set(t, (terms.get(t) ?? 0) + 1)
    for (const t of terms.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    return { ...p, terms, len: tokens.length }
  })
  const avgLen = docs.reduce((a, d) => a + d.len, 0) / Math.max(1, docs.length)
  const index = { stamp, docs, df, avgLen }
  cache.set(projectId, index)
  return index
}

/** Markdown markers (headings, bold, tables, links) taken out, for short excerpts shown as plain text. */
export function plainText(md: string) {
  return md
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/^\s{0,3}(#{1,6}|>)\s+/gm, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).join(" · "))
}

/** A short excerpt around the densest cluster of query words, with matches wrapped in «». */
export function snippet(text: string, queryTerms: string[], size = 240) {
  const flat = plainText(text).replace(/\s+/g, " ")
  const words = [...flat.matchAll(/[\p{L}\p{N}]+/gu)]
  const want = new Set(queryTerms)
  const hits = words.filter((m) => want.has(stem(m[0].toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""))))
  let start = 0
  if (hits.length) {
    let best = 0
    let bestAt = hits[0].index ?? 0
    for (const h of hits) {
      const at = h.index ?? 0
      const n = hits.filter((x) => (x.index ?? 0) >= at && (x.index ?? 0) < at + size).length
      if (n > best) {
        best = n
        bestAt = at
      }
    }
    start = Math.max(0, bestAt - 60)
    const space = flat.lastIndexOf(" ", start)
    if (start > 0 && space > 0 && start - space < 30) start = space + 1
  }
  const end = Math.min(flat.length, start + size)
  const out = flat.slice(start, end).replace(/[\p{L}\p{N}]+/gu, (w) =>
    want.has(stem(w.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, ""))) ? `«${w}»` : w,
  )
  return `${start > 0 ? "…" : ""}${out}${end < flat.length ? "…" : ""}`
}

export async function search(
  projectId: string,
  query: string,
  opts: { limit?: number; kinds?: Passage["kind"][]; sourceIds?: string[] } = {},
): Promise<Hit[]> {
  const q = [...new Set(tokenize(query))]
  if (!q.length) return []
  const { docs, df, avgLen } = await buildIndex(projectId)
  const N = docs.length
  const k1 = 1.4
  const b = 0.75
  const scored: Hit[] = []
  for (const d of docs) {
    if (opts.kinds && !opts.kinds.includes(d.kind)) continue
    if (opts.sourceIds && d.kind === "source" && !opts.sourceIds.includes(d.ref)) continue
    let score = 0
    let matched = 0
    for (const t of q) {
      const f = d.terms.get(t)
      if (!f) continue
      matched++
      const n = df.get(t) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.len) / avgLen))
    }
    if (!score) continue
    // Passages that contain more of the query's words come first.
    score *= 0.5 + (0.5 * matched) / q.length
    const { terms: _t, len: _l, ...p } = d
    scored.push({ ...p, score, snippet: "" })
  }
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, opts.limit ?? 30)
  for (const h of top) h.snippet = snippet(h.text, q)
  return top
}

/** One passage of a paper, by page and position, for showing what a chat answer relied on. */
export async function passage(projectId: string, sourceId: string, page: number, chunk: number) {
  const src = await sources.getSource(projectId, sourceId)
  const all = sourcePassages(src, await sources.sourceText(projectId, sourceId))
  return all.find((p) => p.page === page && p.chunk === chunk) ?? all.find((p) => p.page === page) ?? null
}
