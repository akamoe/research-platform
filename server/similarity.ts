import { listSources, sourceText, type Source } from "./sources.ts"
import { CITED } from "./feedback.ts"

/**
 * A self-check for wording taken from the student's own sources: which passages of a draft repeat
 * a source word for word, or stay very close to it. Everything runs on the computer against the
 * project's sources only; it isn't an internet plagiarism checker. It points at passages and never
 * suggests new wording.
 */

export type MatchKind = "copied" | "close" | "quoted"
export interface Match {
  id: string
  kind: MatchKind
  /** The student's words, exactly as in the text, so the editor can mark them. */
  quote: string
  words: number
  sourceId: string
  sourceTitle: string
  page?: number
  /** The matching words in the source. */
  excerpt: string
  /** A citation is in the same sentence. */
  cited: boolean
}
export interface Report {
  words: number
  /** Words in copied or close passages that aren't in quotation marks. */
  flaggedWords: number
  matches: Match[]
  bySource: { sourceId: string; title: string; words: number }[]
  /** Sources that have no text to compare with (e.g. scans). */
  unreadable: string[]
}

/** Copied passages are at least this many words in a row. */
const MIN_RUN = 8
/** Sentences that share this share of their word triples with one source are "close". */
const CLOSE_SHARE = 0.5
const MAX_POSTINGS = 40

interface Tok {
  w: string
  start: number
  end: number
}
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu
// Same word whatever the diacritics, apostrophes or Arabic letter variants.
const norm = (w: string) =>
  w
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟ]/g, "")
    .replace(/[’']/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")

function tokens(text: string): Tok[] {
  return [...text.matchAll(WORD)].map((m) => ({ w: norm(m[0]), start: m.index!, end: m.index! + m[0].length }))
}

interface Indexed {
  source: Source
  text: string
  toks: Tok[]
  pages: number[]
  /** PDFs have pages; web pages, videos and text don't. */
  paged: boolean
  /** Word triple → positions where it starts. */
  tri: Map<string, number[]>
}

function indexSource(source: Source, raw: string): Indexed {
  // "[page N]" lines mark where each PDF page starts.
  const text = raw
  const toks: Tok[] = []
  const pages: number[] = []
  let page = 1
  const re = /^\[page (\d+)\]\s*$/gm
  let last = 0
  const pieces: [number, number, number][] = []
  for (let m = re.exec(text); m; m = re.exec(text)) {
    pieces.push([last, m.index, page])
    page = Number(m[1])
    last = m.index + m[0].length
  }
  pieces.push([last, text.length, page])
  for (const [a, b, p] of pieces) {
    for (const t of tokens(text.slice(a, b))) {
      toks.push({ w: t.w, start: t.start + a, end: t.end + a })
      pages.push(p)
    }
  }
  const tri = new Map<string, number[]>()
  for (let i = 0; i + 2 < toks.length; i++) {
    const k = `${toks[i].w} ${toks[i + 1].w} ${toks[i + 2].w}`
    const list = tri.get(k)
    if (!list) tri.set(k, [i])
    else if (list.length <= MAX_POSTINGS) list.push(i)
  }
  return { source, text, toks, pages, paged: (source.type ?? "pdf") === "pdf", tri }
}

const cache = new Map<string, { key: string; idx: Indexed }>()
async function indexed(projectId: string) {
  const out: Indexed[] = []
  const unreadable: string[] = []
  for (const s of await listSources(projectId)) {
    if (s.hasText === false) {
      if (!unreadable.includes(s.title)) unreadable.push(s.title)
      continue
    }
    const raw = await sourceText(projectId, s.id)
    if (!raw.trim()) continue
    const ck = `${projectId}/${s.id}`
    const key = `${raw.length}:${raw.slice(0, 64)}:${raw.slice(-64)}`
    let hit = cache.get(ck)
    if (!hit || hit.key !== key) {
      hit = { key, idx: indexSource(s, raw) }
      cache.set(ck, hit)
    }
    out.push(hit.idx)
  }
  return { sources: out, unreadable }
}

/** Character ranges of the text inside quotation marks. */
function quotedRanges(text: string) {
  const out: [number, number][] = []
  for (const m of text.matchAll(/“[^”]{3,}”|«[^»]{3,}»|"[^"\n]{3,}"|„[^“”]{3,}[“”]/g)) out.push([m.index!, m.index! + m[0].length])
  return out
}

const sentenceAt = (text: string, at: number) => {
  let a = at
  while (a > 0 && !/[.!?\n]/.test(text[a - 1])) a--
  let b = at
  while (b < text.length && !/[.!?\n]/.test(text[b])) b++
  // Include a citation just after the full stop, as in "... memory. (Walker, 2009)".
  return text.slice(a, Math.min(text.length, b + 40))
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim()

/**
 * Compare a draft (as readable text: no markdown or LaTeX commands) with every source in the project.
 * Text in quotation marks, and blockquotes, count as quoted.
 */
export async function check(projectId: string, text: string): Promise<Report> {
  const { sources, unreadable } = await indexed(projectId)
  const toks = tokens(text)
  const quoted = quotedRanges(text)
  const inQuotes = (t: Tok) => quoted.some(([a, b]) => t.start >= a && t.end <= b)
  const report: Report = { words: toks.length, flaggedWords: 0, matches: [], bySource: [], unreadable }
  if (!toks.length || !sources.length) return report

  // 1. Runs of words in the same order as a source.
  const runs: { i: number; len: number; s: Indexed; j: number }[] = []
  let i = 0
  while (i + 2 < toks.length) {
    const k = `${toks[i].w} ${toks[i + 1].w} ${toks[i + 2].w}`
    let best: { len: number; s: Indexed; j: number } | null = null
    for (const s of sources) {
      for (const j of s.tri.get(k) ?? []) {
        let len = 3
        while (i + len < toks.length && j + len < s.toks.length && toks[i + len].w === s.toks[j + len].w) len++
        if (!best || len > best.len) best = { len, s, j }
      }
    }
    if (best && best.len >= MIN_RUN) {
      runs.push({ i, ...best })
      i += best.len
    } else i++
  }
  // Join runs from the same place in a source split by a word or two that changed.
  const joined: { i: number; end: number; s: Indexed; j: number; jEnd: number; edited: boolean }[] = []
  for (const r of runs) {
    const prev = joined[joined.length - 1]
    if (prev && prev.s === r.s && r.i - prev.end <= 3 && r.j - prev.jEnd >= 0 && r.j - prev.jEnd <= 5) {
      prev.end = r.i + r.len
      prev.jEnd = r.j + r.len
      prev.edited = true
    } else joined.push({ i: r.i, end: r.i + r.len, s: r.s, j: r.j, jEnd: r.j + r.len, edited: false })
  }

  const covered = new Uint8Array(toks.length)
  let seq = 0
  const startOf = new Map<string, number>()
  const add = (kind: MatchKind, a: number, b: number, s: Indexed, ja: number, jb: number) => {
    const quote = squash(text.slice(toks[a].start, toks[b - 1].end))
    // A source's own title, repeated in the draft, isn't copying.
    const titleWords = tokens(s.source.title).map((t) => t.w).join(" ")
    if (titleWords && titleWords.includes(toks.slice(a, b).map((t) => t.w).join(" ")) && kind !== "close") return
    for (let x = a; x < b; x++) covered[x] = 1
    const id = `m${++seq}`
    startOf.set(id, a)
    report.matches.push({
      id,
      kind,
      quote,
      words: b - a,
      sourceId: s.source.id,
      sourceTitle: s.source.title,
      page: s.paged ? s.pages[ja] : undefined,
      excerpt: squash(s.text.slice(s.toks[ja].start, s.toks[Math.min(jb, s.toks.length) - 1].end)).slice(0, 600),
      cited: CITED.test(sentenceAt(text, toks[a].start)),
    })
  }
  for (const r of joined) {
    const q = toks.slice(r.i, r.end).filter(inQuotes).length
    add(q >= (r.end - r.i) * 0.8 ? "quoted" : r.edited ? "close" : "copied", r.i, r.end, r.s, r.j, r.jEnd)
  }

  // 2. Sentences that keep most of a source's word triples, reordered or lightly changed.
  const sentences: [number, number][] = []
  let a = 0
  for (let x = 0; x < toks.length; x++) {
    const gap = text.slice(toks[x].end, toks[x + 1]?.start ?? text.length)
    if (/[.!?]|\n/.test(gap) || x === toks.length - 1) {
      sentences.push([a, x + 1])
      a = x + 1
    }
  }
  for (const [sa, sb] of sentences) {
    if (sb - sa < 10) continue
    let done = 0
    for (let x = sa; x < sb; x++) done += covered[x]
    // Mostly copied word for word already: the copied passages say it best.
    if (done >= (sb - sa) * 0.6) continue
    if (toks.slice(sa, sb).filter(inQuotes).length > (sb - sa) / 2) continue
    const keys: string[] = []
    for (let x = sa; x + 2 < sb; x++) keys.push(`${toks[x].w} ${toks[x + 1].w} ${toks[x + 2].w}`)
    let best: { s: Indexed; share: number; at: number[] } | null = null
    for (const s of sources) {
      const at: number[] = []
      let shared = 0
      for (const k of keys) {
        const p = s.tri.get(k)
        // Very common triples ("one of the") say nothing.
        if (p && p.length <= MAX_POSTINGS) {
          shared++
          at.push(p[0])
        }
      }
      const share = shared / keys.length
      if (shared >= 4 && share >= CLOSE_SHARE && (!best || share > best.share)) best = { s, share, at }
    }
    if (!best) continue
    // The source passage: the densest stretch of the shared triples.
    const at = best.at.sort((x, y) => x - y)
    const mid = at[Math.floor(at.length / 2)]
    const near = at.filter((p) => Math.abs(p - mid) <= (sb - sa) * 2)
    // The whole sentence stays close to the source: one match instead of its copied pieces.
    report.matches = report.matches.filter((m) => {
      const at = startOf.get(m.id)!
      return m.kind === "quoted" || at < sa || at >= sb
    })
    add("close", sa, sb, best.s, near[0], near[near.length - 1] + 3)
  }

  report.matches.sort((x, y) => startOf.get(x.id)! - startOf.get(y.id)!)
  const per = new Map<string, number>()
  for (const m of report.matches) {
    if (m.kind === "quoted") continue
    report.flaggedWords += m.words
    per.set(m.sourceId, (per.get(m.sourceId) ?? 0) + m.words)
  }
  report.bySource = [...per]
    .map(([sourceId, words]) => ({ sourceId, words, title: sources.find((s) => s.source.id === sourceId)!.source.title }))
    .sort((x, y) => y.words - x.words)
  return report
}

/** Notes keep reading quotes as blockquotes: mark them as quoted before the markdown is flattened. */
export const quoteBlockquotes = (md: string) => md.replace(/^>\s?(.+)$/gm, (_, line: string) => `> “${line.trim()}”`)
/** LaTeX quotation marks, ``like this'', as curly quotes. */
export const latexQuotes = (tex: string) => tex.replace(/``([\s\S]*?)''/g, "“$1”").replace(/\\enquote\{([^}]*)\}/g, "“$1”")
