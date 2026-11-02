import fs from "node:fs/promises"
import path from "node:path"
import YAML from "yaml"
import { z } from "zod"
import { completeJson } from "./ai.ts"
import { HttpError, PROJECTS_DIR, safeJoin } from "./paths.ts"
import { getProject } from "./projects.ts"
import * as sources from "./sources.ts"

/**
 * Each project's knowledge base is an Open Knowledge Format (OKF v0.2) bundle in
 * `<project>/knowledge/`, kept by the AI the way Karpathy's LLM wiki works:
 * ingest a source -> pages are created or updated; query -> chat reads the pages;
 * lint -> look for contradictions, gaps and broken links.
 *
 *   knowledge/index.md            catalog of pages, grouped by type (regenerated)
 *   knowledge/log.md              what changed, newest first
 *   knowledge/papers/<slug>.md    one page per paper (type: Paper)
 *   knowledge/concepts/<slug>.md  ideas, methods, findings shared across papers
 */

export const OKF_VERSION = "0.2"

export interface PageMeta {
  id: string
  type: string
  title: string
  description: string
  tags: string[]
  sources: { id?: string; resource: string; title?: string }[]
  generated?: { by: string; at?: string }
  verified?: { by: string; at: string }[]
  status?: string
  contested?: boolean
}

export interface Page extends PageMeta {
  body: string
  raw: string
}

function kbDir(projectId: string) {
  if (!/^[\w-]+$/.test(projectId)) throw new HttpError(400, "Invalid project id")
  return path.join(PROJECTS_DIR, projectId, "knowledge")
}

function pageFile(projectId: string, pageId: string) {
  if (!/^[\w-]+(\/[\w-]+)*$/.test(pageId)) throw new HttpError(400, "Invalid page id")
  if (/^(index|log)$/.test(path.posix.basename(pageId))) throw new HttpError(400, "Reserved file name")
  return safeJoin(kbDir(projectId), `${pageId}.md`)
}

export function slug(text: string) {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 60)
      .replace(/-$/, "") || "page"
  )
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z")

// ---------- reading and writing pages ----------

function parse(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!m) return { fm: {}, body: raw }
  let fm: Record<string, unknown> = {}
  try {
    fm = (YAML.parse(m[1]) as Record<string, unknown>) ?? {}
  } catch {}
  return { fm, body: raw.slice(m[0].length).replace(/^\s*\n/, "") }
}

function serialize(fm: Record<string, unknown>, body: string) {
  const clean = Object.fromEntries(Object.entries(fm).filter(([, v]) => v !== undefined && v !== null))
  return `---\n${YAML.stringify(clean, { lineWidth: 0 })}---\n\n${body.trim()}\n`
}

function toMeta(id: string, fm: Record<string, unknown>, body: string): PageMeta {
  const firstHeading = /^#\s+(.+)$/m.exec(body)?.[1]
  const verified = fm.verified
  return {
    id,
    type: typeof fm.type === "string" ? fm.type : "Concept",
    title: typeof fm.title === "string" ? fm.title : (firstHeading ?? path.posix.basename(id)),
    description: typeof fm.description === "string" ? fm.description : "",
    tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
    sources: Array.isArray(fm.sources) ? (fm.sources as PageMeta["sources"]) : [],
    generated: fm.generated as PageMeta["generated"],
    // OKF allows a single mapping instead of a list.
    verified: verified ? ((Array.isArray(verified) ? verified : [verified]) as PageMeta["verified"]) : undefined,
    status: typeof fm.status === "string" ? fm.status : undefined,
    contested: fm.contested === true,
  }
}

export async function readPage(projectId: string, pageId: string): Promise<Page> {
  const raw = await fs.readFile(pageFile(projectId, pageId), "utf8").catch(() => {
    throw new HttpError(404, "Page not found")
  })
  const { fm, body } = parse(raw)
  return { ...toMeta(pageId, fm, body), body, raw }
}

async function readFm(projectId: string, pageId: string) {
  try {
    return parse(await fs.readFile(pageFile(projectId, pageId), "utf8"))
  } catch {
    return null
  }
}

async function writePage(projectId: string, pageId: string, fm: Record<string, unknown>, body: string) {
  const file = pageFile(projectId, pageId)
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, serialize(fm, body))
}

export async function listPages(projectId: string): Promise<PageMeta[]> {
  await getProject(projectId)
  const root = kbDir(projectId)
  await fs.mkdir(root, { recursive: true })
  const out: PageMeta[] = []
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.name.endsWith(".md") && e.name !== "index.md" && e.name !== "log.md") {
        const id = path.relative(root, full).split(path.sep).join("/").replace(/\.md$/, "")
        if (!/^[\w-]+(\/[\w-]+)*$/.test(id)) continue
        const { fm, body } = parse(await fs.readFile(full, "utf8"))
        out.push(toMeta(id, fm, body))
      }
    }
  }
  await walk(root)
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

/** The student edits a page by hand: the edit is theirs, so it counts as reviewed. */
export async function savePageRaw(projectId: string, pageId: string, raw: string) {
  const { fm, body } = parse(raw)
  if (typeof fm.type !== "string" || !fm.type.trim()) throw new HttpError(400, "A page needs a `type:` in its frontmatter")
  fm.generated = { by: "human:student", at: now() }
  await writePage(projectId, pageId, fm, body)
  await rebuildIndex(projectId)
  await appendLog(projectId, [`**Update**: You edited [${toMeta(pageId, fm, body).title}](/${pageId}.md).`])
  return readPage(projectId, pageId)
}

/** OKF trust tier "human-reviewed": the student confirmed the page against its sources. */
export async function markReviewed(projectId: string, pageId: string) {
  const page = await readFm(projectId, pageId)
  if (!page) throw new HttpError(404, "Page not found")
  const prev = page.fm.verified ? (Array.isArray(page.fm.verified) ? page.fm.verified : [page.fm.verified]) : []
  page.fm.verified = [...prev.filter((v: { by?: string }) => v?.by !== "human:student"), { by: "human:student", at: now() }]
  if (page.fm.status === "draft") page.fm.status = "stable"
  await writePage(projectId, pageId, page.fm, page.body)
  return readPage(projectId, pageId)
}

// ---------- index.md and log.md ----------

const TYPE_ORDER = ["Paper", "Concept", "Theory", "Method", "Measure", "Finding", "Population", "Debate"]
const plural = (t: string) => (/[sxz]$/.test(t) ? `${t}es` : /y$/.test(t) ? `${t.slice(0, -1)}ies` : `${t}s`)

export async function rebuildIndex(projectId: string) {
  const pages = await listPages(projectId)
  const groups = new Map<string, PageMeta[]>()
  for (const p of pages) groups.set(p.type, [...(groups.get(p.type) ?? []), p])
  const types = [...groups.keys()].sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a)
    const ib = TYPE_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
  const sections = types.map(
    (t) =>
      `# ${plural(t)}\n\n` +
      groups
        .get(t)!
        .map((p) => `* [${p.title}](/${p.id}.md)${p.description ? ` - ${p.description}` : ""}`)
        .join("\n"),
  )
  const body = sections.length ? sections.join("\n\n") : "# Pages\n\nNothing here yet. Add a paper to start the knowledge base."
  await fs.writeFile(path.join(kbDir(projectId), "index.md"), `---\nokf_version: "${OKF_VERSION}"\n---\n\n${body}\n`)
}

export async function appendLog(projectId: string, entries: string[]) {
  if (!entries.length) return
  const file = path.join(kbDir(projectId), "log.md")
  await fs.mkdir(path.dirname(file), { recursive: true })
  const today = now().slice(0, 10)
  let text = await fs.readFile(file, "utf8").catch(() => "# Knowledge base log\n")
  const lines = entries.map((e) => `* ${e}`).join("\n")
  const heading = `## ${today}`
  if (text.includes(`\n${heading}\n`)) text = text.replace(`\n${heading}\n`, `\n${heading}\n${lines}\n`)
  else {
    const at = text.indexOf("\n## ")
    const block = `\n${heading}\n${lines}\n`
    text = at < 0 ? `${text.trimEnd()}\n${block}` : `${text.slice(0, at)}\n${block.trimEnd()}\n${text.slice(at)}`
  }
  await fs.writeFile(file, text)
}

export async function readLog(projectId: string) {
  return fs.readFile(path.join(kbDir(projectId), "log.md"), "utf8").catch(() => "# Knowledge base log\n\nNothing yet.\n")
}

// ---------- markdown section helpers ----------

/** Replace or add `### heading` inside `## section`, creating the section if needed. */
function upsertSubsection(body: string, section: string, heading: string, content: string) {
  const block = `### ${heading}\n\n${content.trim()}\n`
  const sec = new RegExp(`^## ${escape(section)}\\s*$`, "m").exec(body)
  if (!sec) return `${body.trimEnd()}\n\n## ${section}\n\n${block}`
  const start = sec.index + sec[0].length
  const nextSec = body.slice(start).search(/^## /m)
  const end = nextSec < 0 ? body.length : start + nextSec
  let inner = body.slice(start, end)
  const sub = new RegExp(`^### ${escape(heading)}\\s*$`, "m").exec(inner)
  if (sub) {
    const subEnd = inner.slice(sub.index + sub[0].length).search(/^###? /m)
    const stop = subEnd < 0 ? inner.length : sub.index + sub[0].length + subEnd
    inner = `${inner.slice(0, sub.index)}${block}\n${inner.slice(stop).replace(/^\n+/, "")}`
  } else inner = `${inner.trimEnd()}\n\n${block}\n`
  return `${body.slice(0, start)}\n${inner.replace(/^\n+/, "\n")}${body.slice(end)}`.replace(/\n{3,}/g, "\n\n")
}

/** Add bullets to `## section` (skipping ones already there), creating it if needed. */
function addBullets(body: string, section: string, bullets: string[]) {
  const fresh = bullets.filter((b) => !body.includes(b))
  if (!fresh.length) return body
  const lines = fresh.map((b) => `- ${b}`).join("\n")
  const sec = new RegExp(`^## ${escape(section)}\\s*$`, "m").exec(body)
  if (!sec) return `${body.trimEnd()}\n\n## ${section}\n\n${lines}\n`
  const start = sec.index + sec[0].length
  const nextSec = body.slice(start).search(/^## /m)
  const end = nextSec < 0 ? body.length : start + nextSec
  return `${body.slice(0, end).trimEnd()}\n${lines}\n\n${body.slice(end)}`.replace(/\n{3,}/g, "\n\n")
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (none noted)")

// ---------- ingest: a paper becomes pages ----------

const CURATOR = `You maintain a research knowledge base for a student, following the Open Knowledge Format (OKF) and Karpathy's "LLM wiki" pattern: every source is read once, and what it says is filed into small, linked pages so knowledge accumulates instead of being re-read.

Rules:
- Be faithful to the source. Never invent findings, numbers, authors or citations. Cite page numbers like (p. 3) when the text has [page N] markers.
- Write terse notes (bullets of one sentence), not essays. These are the knowledge base's notes, not the student's paper.
- Reuse an existing page id when the paper talks about the same idea; create a new one only for a distinct idea.
- Flag real tensions: when this paper disagrees with, qualifies or fails to replicate something on an existing page, say so concretely and name that page.
- Reply with JSON only.`

const IngestResult = z.object({
  paper: z.object({
    description: z.string(),
    tags: z.array(z.string()).default([]),
    claims: z.array(z.string()).default([]),
    methods: z.array(z.string()).default([]),
    limitations: z.array(z.string()).default([]),
    questions: z.array(z.string()).default([]),
  }),
  concepts: z
    .array(
      z.object({
        id: z.string(),
        title: z.string(),
        type: z.string().default("Concept"),
        description: z.string().default(""),
        tags: z.array(z.string()).default([]),
        points: z.array(z.string()).default([]),
        tensions: z.array(z.string()).default([]),
      }),
    )
    .default([]),
})

const PAPER_CHARS = 60_000
const jobs = new Map<string, Map<string, { title: string; startedAt: string }>>()
const lastErrors = new Map<string, Map<string, string>>()
let queue: Promise<unknown> = Promise.resolve()

/** Ingests one at a time so two papers never edit the same page at once. */
export function ingestPaperInBackground(projectId: string, sourceId: string, title: string) {
  const running = jobs.get(projectId) ?? new Map()
  jobs.set(projectId, running)
  if (running.has(sourceId)) return
  running.set(sourceId, { title, startedAt: now() })
  lastErrors.get(projectId)?.delete(sourceId)
  queue = queue
    .then(() => ingestPaper(projectId, sourceId))
    .catch((err: Error) => {
      const errs = lastErrors.get(projectId) ?? new Map()
      errs.set(sourceId, err.message)
      lastErrors.set(projectId, errs)
    })
    .finally(() => running.delete(sourceId))
}

async function findPaperPage(projectId: string, sourceId: string) {
  const pages = await listPages(projectId)
  return pages.find((p) => p.type === "Paper" && p.sources.some((s) => s.id === sourceId))
}

export async function ingestPaper(projectId: string, sourceId: string) {
  const src = await sources.getSource(projectId, sourceId)
  const text = await sources.sourceText(projectId, sourceId)
  if (!text.trim()) throw new HttpError(400, `No text could be read from "${src.title}"`)
  const pages = await listPages(projectId)

  // Existing concept pages this paper probably touches, so the model can spot tensions.
  const lower = text.toLowerCase()
  const related = pages
    .filter((p) => p.type !== "Paper" && lower.includes(p.title.toLowerCase()))
    .slice(0, 10)
  const relatedText = (
    await Promise.all(related.map(async (p) => `<page id="${p.id}">\n${(await readPage(projectId, p.id)).body.slice(0, 4000)}\n</page>`))
  ).join("\n")

  const index = pages.map((p) => `- ${p.id} (${p.type}): ${p.title}${p.description ? ` - ${p.description}` : ""}`).join("\n")
  const prompt = `Existing pages in the knowledge base:
${index || "(none yet)"}

${relatedText ? `Existing pages this paper may relate to:\n${relatedText}\n` : ""}
New source to file: "${src.title}"
<paper>
${text.slice(0, PAPER_CHARS)}
</paper>

Return JSON:
{
  "paper": {
    "description": "one sentence: what the paper did and found",
    "tags": ["2-5 short lowercase tags"],
    "claims": ["key claims or findings, with (p. N)"],
    "methods": ["design, sample, measures"],
    "limitations": ["limitations the paper states or that are evident"],
    "questions": ["open questions it raises"]
  },
  "concepts": [
    {
      "id": "concepts/<lowercase-hyphenated>, or an existing page id",
      "title": "Concept name",
      "type": "Concept | Theory | Method | Measure | Finding | Population | Debate",
      "description": "one sentence definition (used if the page is new)",
      "tags": ["..."],
      "points": ["what THIS paper says about it, with (p. N)"],
      "tensions": ["only if it conflicts with an existing page: what differs, naming the page"]
    }
  ]
}
Use at most 8 concepts, only ones that matter for this paper.`

  const { data, actor } = await completeJson(CURATOR, prompt, IngestResult)
  const at = now()
  // The original: the PDF, or the page or video it came from, or its text.
  const pdf = !src.type || src.type === "pdf" ? `../sources/${src.id}.pdf` : (src.url ?? `../sources/${src.id}.txt`)
  const sourceRef = { id: src.id, resource: pdf, title: src.title }

  // The paper's own page.
  const existing = await findPaperPage(projectId, src.id)
  let paperId = existing?.id ?? `papers/${slug(src.title)}`
  if (!existing && pages.some((p) => p.id === paperId)) paperId = `${paperId}-${src.id}`
  const paperLink = `[${src.title}](/${paperId}.md)`

  const conceptLinks: string[] = []
  const log: string[] = []
  const seen = new Set<string>()
  for (const c of data.concepts.slice(0, 8)) {
    const cid = `concepts/${slug(c.id.split("/").pop() || c.title)}`
    if (seen.has(cid)) continue
    seen.add(cid)
    conceptLinks.push(`[${c.title}](/${cid}.md)`)
    const cur = await readFm(projectId, cid)
    const fm: Record<string, unknown> = cur?.fm ?? {
      type: c.type || "Concept",
      title: c.title,
      description: c.description,
      status: "draft",
    }
    fm.tags = [...new Set([...((fm.tags as string[]) ?? []), ...c.tags.map((t) => t.toLowerCase())])]
    const srcs = (fm.sources as PageMeta["sources"]) ?? []
    if (!srcs.some((s) => s.id === src.id)) srcs.push(sourceRef)
    fm.sources = srcs
    fm.generated = { by: actor, at }
    let body = cur?.body ?? `# ${c.title}\n\n${c.description}\n`
    body = upsertSubsection(body, "From the papers", paperLink, list(c.points))
    if (c.tensions.length) {
      body = addBullets(body, "Tensions", c.tensions.map((t) => `${t} (${paperLink})`))
      fm.contested = true
    }
    await writePage(projectId, cid, fm, body)
    log.push(cur ? `**Update**: [${fm.title}](/${cid}.md) with ${paperLink}.` : `**Creation**: [${c.title}](/${cid}.md).`)
    if (c.tensions.length) log.push(`**Tension**: ${paperLink} conflicts with [${fm.title}](/${cid}.md).`)
  }

  const paperFm: Record<string, unknown> = {
    type: "Paper",
    title: src.title,
    description: data.paper.description,
    resource: pdf,
    tags: data.paper.tags.map((t) => t.toLowerCase()),
    sources: [sourceRef],
    generated: { by: actor, at },
    status: "draft",
  }
  const paperBody = `# ${src.title}

${data.paper.description}

## Key claims

${list(data.paper.claims)}

## Methods

${list(data.paper.methods)}

## Limitations

${list(data.paper.limitations)}

## Open questions

${list(data.paper.questions)}

## Concepts

${list(conceptLinks)}
`
  await writePage(projectId, paperId, paperFm, paperBody)
  await rebuildIndex(projectId)
  await appendLog(projectId, [`**Ingest**: Read ${paperLink}.`, ...log])
  return readPage(projectId, paperId)
}

// ---------- lint: what's wrong or missing ----------

export interface Finding {
  kind: "contradiction" | "gap" | "duplicate" | "unsupported" | "broken-link" | "orphan" | "question"
  pages: string[]
  message: string
}

const LintResult = z.object({
  findings: z
    .array(
      z.object({
        kind: z.string(),
        pages: z.array(z.string()).default([]),
        message: z.string(),
      }),
    )
    .default([]),
})

const KINDS = new Set(["contradiction", "gap", "duplicate", "unsupported", "question"])

export async function lint(projectId: string) {
  const pages = await listPages(projectId)
  const full = await Promise.all(pages.map((p) => readPage(projectId, p.id)))
  const ids = new Set(pages.map((p) => p.id))
  const findings: Finding[] = []

  // Mechanical checks: broken links and pages nothing links to.
  const inbound = new Map<string, number>()
  for (const p of full) {
    for (const m of p.body.matchAll(/\]\(\/([\w/-]+)\.md\)/g)) {
      if (!ids.has(m[1])) findings.push({ kind: "broken-link", pages: [p.id], message: `Links to /${m[1]}.md, which doesn't exist.` })
      else if (m[1] !== p.id) inbound.set(m[1], (inbound.get(m[1]) ?? 0) + 1)
    }
  }
  for (const p of pages) {
    if (p.type !== "Paper" && !inbound.get(p.id)) findings.push({ kind: "orphan", pages: [p.id], message: "No other page links here." })
  }

  // The model reads everything and looks for what a careful reviewer would.
  if (full.length) {
    let budget = 100_000
    const corpus = full
      .map((p) => {
        const chunk = `<page id="${p.id}" type="${p.type}">\n${p.body.slice(0, Math.min(5000, budget))}\n</page>`
        budget -= chunk.length
        return budget > 0 ? chunk : ""
      })
      .join("\n")
    const { data } = await completeJson(
      CURATOR,
      `Review this knowledge base like a careful supervisor. Find:
- contradiction: pages or papers that disagree (name both pages)
- gap: an important idea mentioned but with no page, or a claim that rests on a single paper
- duplicate: two pages about the same thing
- unsupported: a statement with no paper behind it
- question: an open question the student should look into next
Be specific and brief. At most 12 findings, most important first.

${corpus}

Return JSON: {"findings": [{"kind": "...", "pages": ["page ids"], "message": "one or two sentences"}]}`,
      LintResult,
    )
    for (const f of data.findings) {
      findings.push({
        kind: (KINDS.has(f.kind) ? f.kind : "question") as Finding["kind"],
        pages: f.pages.filter((id) => ids.has(id.replace(/^\/|\.md$/g, ""))).map((id) => id.replace(/^\/|\.md$/g, "")),
        message: f.message,
      })
    }
  }

  const report = { at: now(), findings }
  await fs.writeFile(path.join(kbDir(projectId), ".lint.json"), JSON.stringify(report, null, 2))
  const n = (k: Finding["kind"]) => findings.filter((f) => f.kind === k).length
  await appendLog(projectId, [
    `**Lint**: ${findings.length} finding${findings.length === 1 ? "" : "s"} (${n("contradiction")} contradictions, ${n("gap")} gaps, ${n("broken-link")} broken links).`,
  ])
  return report
}

export async function lastLint(projectId: string): Promise<{ at: string; findings: Finding[] } | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(kbDir(projectId), ".lint.json"), "utf8"))
  } catch {
    return null
  }
}

// ---------- status ----------

export async function status(projectId: string) {
  const [pages, srcs] = await Promise.all([listPages(projectId), sources.listSources(projectId)])
  const ingested = new Set(pages.filter((p) => p.type === "Paper").flatMap((p) => p.sources.map((s) => s.id)))
  const running = jobs.get(projectId) ?? new Map()
  const errors = lastErrors.get(projectId) ?? new Map()
  return {
    pages: pages.length,
    notIngested: srcs
      .filter((s) => s.hasText && !ingested.has(s.id))
      .map((s) => ({ id: s.id, title: s.title, running: running.has(s.id), error: errors.get(s.id) ?? null })),
    running: [...running.entries()].map(([id, j]) => ({ id, title: j.title })),
  }
}

// ---------- query: what chat gets to read ----------

const STOP = new Set("about after again also because been before being between both does doing from have into just more most only other over same some such than that their them then there these they this those through under very what when where which while will with would your".split(" "))

/** The index plus the few pages most relevant to the question, for the chat's system prompt. */
export async function contextFor(projectId: string, question: string, budget = 24_000) {
  const pages = await listPages(projectId).catch(() => [])
  if (!pages.length) return null
  const words = [...new Set(question.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) ?? [])].filter((w) => !STOP.has(w))
  const full = await Promise.all(pages.map((p) => readPage(projectId, p.id)))
  const scored = full
    .map((p) => {
      const title = p.title.toLowerCase()
      const desc = p.description.toLowerCase()
      const body = p.body.toLowerCase()
      let score = 0
      for (const w of words) {
        if (title.includes(w)) score += 6
        if (desc.includes(w)) score += 2
        score += Math.min(5, body.split(w).length - 1)
      }
      return { p, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)

  const index = pages.map((p) => `- [${p.title}](/${p.id}.md) (${p.type})${p.description ? `: ${p.description}` : ""}`).join("\n")
  let left = budget - index.length
  const chosen: string[] = []
  for (const { p } of scored.slice(0, 5)) {
    const chunk = `<page id="${p.id}">\n${p.body.slice(0, 6000)}\n</page>`
    if (chunk.length > left) break
    chosen.push(chunk)
    left -= chunk.length
  }
  return { index, pages: chosen.join("\n") }
}
