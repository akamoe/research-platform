import fs from "node:fs/promises"
import path from "node:path"
import { Cite, plugins } from "@citation-js/core"
import "@citation-js/plugin-bibtex"
import "@citation-js/plugin-ris"
import "@citation-js/plugin-csl"
import { DATA_DIR, HttpError, PROJECTS_DIR, TRASH_DIR, safeJoin } from "./paths.ts"
import { getProject, touchProject } from "./projects.ts"

/**
 * The project's reference library. Stored as CSL-JSON (the format citation styles read) in
 * `references.json`, with a matching `references.bib` written next to it for LaTeX and other tools.
 */

export interface CslName {
  family?: string
  given?: string
  literal?: string
}
export interface Reference {
  /** Citation key, used as [@key] in notes and \cite{key} in LaTeX. */
  id: string
  type: string
  title?: string
  author?: CslName[]
  editor?: CslName[]
  issued?: { "date-parts"?: (number | string)[][]; literal?: string }
  "container-title"?: string
  volume?: string
  issue?: string
  page?: string
  publisher?: string
  DOI?: string
  URL?: string
  ISBN?: string
  abstract?: string
  /** The paper (PDF) in this project this reference describes, if any. */
  source?: string
  addedAt?: string
  [field: string]: unknown
}

const CACHE = path.join(DATA_DIR, ".cache", "csl")
const STYLES_RAW = "https://raw.githubusercontent.com/citation-style-language/styles/master"
const LOCALES_RAW = "https://raw.githubusercontent.com/citation-style-language/locales/master"
const STYLE_INDEX = "https://www.zotero.org/styles-files/styles.json"
const DOI_BASE = process.env.RP_DOI_URL ?? "https://doi.org"
const CROSSREF = process.env.RP_CROSSREF_URL ?? "https://api.crossref.org"

function file(projectId: string, name: string) {
  if (!/^[\w-]+$/.test(projectId)) throw new HttpError(400, "Invalid project id")
  return path.join(safeJoin(PROJECTS_DIR, projectId), name)
}

const queues = new Map<string, Promise<unknown>>()
function locked<T>(projectId: string, job: () => Promise<T>): Promise<T> {
  const next = (queues.get(projectId) ?? Promise.resolve()).then(job, job)
  queues.set(projectId, next.catch(() => {}))
  return next
}

export async function list(projectId: string): Promise<Reference[]> {
  await getProject(projectId)
  try {
    const raw = JSON.parse(await fs.readFile(file(projectId, "references.json"), "utf8"))
    return Array.isArray(raw) ? raw : (raw.items ?? [])
  } catch {
    return []
  }
}

async function write(projectId: string, items: Reference[]) {
  const sorted = [...items].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
  const json = file(projectId, "references.json")
  await fs.writeFile(json + ".tmp", JSON.stringify(sorted, null, 2))
  await fs.rename(json + ".tmp", json)
  await fs.writeFile(file(projectId, "references.bib"), sorted.length ? toFormat(sorted, "bibtex") : "")
  await touchProject(projectId)
}

const firstAuthor = (r: Reference) => r.author?.[0]?.family ?? r.author?.[0]?.literal ?? r.editor?.[0]?.family ?? ""
export const yearOf = (r: Reference) => String(r.issued?.["date-parts"]?.[0]?.[0] ?? r.issued?.literal ?? "")
const sortKey = (r: Reference) => `${firstAuthor(r).toLowerCase()} ${yearOf(r)} ${(r.title ?? "").toLowerCase()}`

const ascii = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")

const STOP = new Set(["a", "an", "the", "on", "of", "in", "and", "for", "to", "with", "from", "is", "are", "how", "what", "why"])

/** walker2002practice: first author, year, first real word of the title. */
function makeKey(r: Reference, taken: Set<string>) {
  const word = (r.title ?? "").split(/\s+/).map(ascii).find((w) => w && !STOP.has(w)) ?? ""
  const base = (ascii(firstAuthor(r)) || "ref") + (yearOf(r).replace(/\D/g, "") || "nd") + word
  let key = base
  for (let i = 0; taken.has(key); i++) key = base + String.fromCharCode(97 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "")
  return key
}

const normDoi = (d?: string) => d?.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").toLowerCase()
const normTitle = (t?: string) => (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

/** The library's entry for a paper, by DOI or title. */
export async function findMatch(projectId: string, w: { doi?: string; title?: string }) {
  const items = await list(projectId)
  const doi = normDoi(w.doi)
  const title = normTitle(w.title)
  return items.find((r) => (doi && normDoi(r.DOI) === doi) || (title && normTitle(r.title) === title)) ?? null
}

/** Clean an item from citation-js or a DOI service into the fields we keep. */
function clean(item: Record<string, unknown>): Reference {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(item)) {
    if (v === undefined || v === null || v === "") continue
    if (k.startsWith("_") || k === "citation-key" || k === "reference" || k === "indexed" || k === "deposited") continue
    if (k === "license" || k === "link" || k === "funder" || k === "assertion" || k === "relation") continue
    out[k] = Array.isArray(v) && typeof v[0] === "string" && !["ISSN", "ISBN"].includes(k) ? v[0] : v
  }
  if (typeof out.title !== "string") out.title = Array.isArray(item.title) ? String(item.title[0] ?? "") : ""
  if (typeof out.DOI === "string") out.DOI = normDoi(out.DOI)
  if (typeof out.abstract === "string") out.abstract = out.abstract.replace(/<[^>]+>/g, "").trim()
  if (Array.isArray(out.ISBN)) out.ISBN = out.ISBN[0]
  if (Array.isArray(out.ISSN)) out.ISSN = out.ISSN[0]
  out.type = typeof out.type === "string" && out.type ? out.type : "article-journal"
  return out as Reference
}

/** Add items, skipping ones already in the library (same DOI, or same title and year). Returns what was added. */
export function addItems(projectId: string, incoming: Record<string, unknown>[], opts: { keepIds?: boolean; source?: string } = {}) {
  return locked(projectId, async () => {
    const items = await list(projectId)
    const taken = new Set(items.map((r) => r.id))
    const added: Reference[] = []
    const existing: Reference[] = []
    for (const raw of incoming) {
      const r = clean(raw)
      const dup = items.find(
        (x) =>
          (r.DOI && normDoi(x.DOI) === r.DOI) ||
          (normTitle(r.title) && normTitle(x.title) === normTitle(r.title) && yearOf(x) === yearOf(r)),
      )
      if (dup) {
        if (opts.source && !dup.source) dup.source = opts.source
        existing.push(dup)
        continue
      }
      const wanted = opts.keepIds && typeof raw.id === "string" && /^[\w:.-]+$/.test(raw.id) ? raw.id : ""
      r.id = wanted && !taken.has(wanted) ? wanted : makeKey(r, taken)
      taken.add(r.id)
      r.addedAt = new Date().toISOString()
      if (opts.source) r.source = opts.source
      items.push(r)
      added.push(r)
    }
    if (added.length || opts.source) await write(projectId, items)
    return { added, existing }
  })
}

export function update(projectId: string, id: string, patch: Partial<Reference>) {
  return locked(projectId, async () => {
    const items = await list(projectId)
    const i = items.findIndex((r) => r.id === id)
    if (i < 0) throw new HttpError(404, "Reference not found")
    const next = clean({ ...items[i], ...patch }) as Reference
    if (patch.id && patch.id !== id) {
      if (!/^[\w:.-]+$/.test(patch.id)) throw new HttpError(400, "A citation key can only use letters, numbers and : . - _")
      if (items.some((r) => r.id === patch.id)) throw new HttpError(409, "Another reference already uses that key")
    }
    next.id = patch.id || id
    items[i] = next
    await write(projectId, items)
    return next
  })
}

/** Moves a reference to the trash folder (as its own JSON file) and out of the library. */
export function remove(projectId: string, id: string) {
  return locked(projectId, async () => {
    const items = await list(projectId)
    const r = items.find((x) => x.id === id)
    if (!r) throw new HttpError(404, "Reference not found")
    await fs.mkdir(TRASH_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await fs.writeFile(path.join(TRASH_DIR, `${stamp}-${projectId}-reference-${id}.json`), JSON.stringify(r, null, 2))
    await write(
      projectId,
      items.filter((x) => x.id !== id),
    )
    return r
  })
}

// ---------- reading references from what the student pastes ----------

const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>]+)/gi

async function fetchJson(url: string, accept = "application/json"): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const res = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "Folio/0.1 (local research app; https://github.com/akamoe/research-platform)" },
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json()
}

/** Look up a DOI: the DOI resolver's citation data first, Crossref as a fallback. */
export async function lookupDoi(doi: string): Promise<Record<string, unknown> | null> {
  const d = doi.replace(/[.,;)\]]+$/, "")
  const enc = d.split("/").map(encodeURIComponent).join("/")
  try {
    const data = await fetchJson(`${DOI_BASE}/${enc}`, "application/vnd.citationstyles.csl+json")
    if (data) return data
  } catch {}
  try {
    const data = await fetchJson(`${CROSSREF}/works/${enc}`)
    if (data?.message) return crossrefToCsl(data.message)
  } catch (err) {
    throw new HttpError(502, `Couldn't look up ${d}: ${(err as Error).message}. Check your internet connection.`)
  }
  return null
}

function crossrefToCsl(m: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...m }
  out.type = m.type === "journal-article" ? "article-journal" : m.type === "proceedings-article" ? "paper-conference" : m.type === "book-chapter" ? "chapter" : (m.type ?? "article-journal")
  out.issued = m.issued ?? m["published-print"] ?? m["published-online"]
  return out
}

export interface Candidate {
  title: string
  authors: string
  year: string
  container: string
  doi: string
}

/** Search Crossref by title (and authors) when the student only has the name of a paper. */
export async function search(query: string): Promise<Candidate[]> {
  const q = encodeURIComponent(query.slice(0, 300))
  let data: { message?: { items?: Record<string, unknown>[] } } | null
  try {
    data = await fetchJson(`${CROSSREF}/works?query.bibliographic=${q}&rows=6&select=DOI,title,author,issued,container-title,type`)
  } catch (err) {
    throw new HttpError(502, `Couldn't search for that title: ${(err as Error).message}. Check your internet connection.`)
  }
  return (data?.message?.items ?? []).map((it) => {
    const authors = ((it.author as CslName[] | undefined) ?? []).map((a) => a.family ?? a.literal ?? "").filter(Boolean)
    return {
      title: String((it.title as string[] | undefined)?.[0] ?? ""),
      authors: authors.length > 3 ? `${authors.slice(0, 3).join(", ")} et al.` : authors.join(", "),
      year: String((it.issued as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0]?.[0] ?? ""),
      container: String((it["container-title"] as string[] | undefined)?.[0] ?? ""),
      doi: String(it.DOI ?? "").toLowerCase(),
    }
  })
}

/**
 * Turn pasted text into references: BibTeX, RIS, CSL-JSON, or one or more DOIs / doi.org links.
 * Anything else is treated as a title and searched, and the matches come back for the student to pick.
 */
export async function parse(text: string): Promise<{ items: Record<string, unknown>[]; candidates?: Candidate[] }> {
  const t = text.trim()
  if (!t) throw new HttpError(400, "Paste a DOI, a BibTeX or RIS entry, or a title")
  if (/^\s*@\w+\s*\{/m.test(t) || /^TY {2}- /m.test(t) || /^\s*[[{]/.test(t)) {
    try {
      const c = await Cite.async(t)
      const items = c.data as Record<string, unknown>[]
      if (items.length) return { items }
    } catch (err) {
      throw new HttpError(400, `Couldn't read that entry: ${(err as Error).message}`)
    }
  }
  const dois = [...new Set([...t.matchAll(DOI_RE)].map((m) => m[1].replace(/[.,;)\]]+$/, "")))]
  if (dois.length) {
    const items: Record<string, unknown>[] = []
    const missing: string[] = []
    for (const d of dois.slice(0, 50)) {
      const item = await lookupDoi(d)
      if (item) items.push(item)
      else missing.push(d)
    }
    if (!items.length) throw new HttpError(404, `No record found for ${missing.join(", ")}`)
    return { items }
  }
  return { items: [], candidates: await search(t) }
}

/** Find a DOI on the first pages of a paper's text. */
export function doiInText(text: string) {
  const head = text.slice(0, 12000)
  const m = head.match(DOI_RE)
  return m?.[0]?.replace(/[.,;)\]]+$/, "")
}

/** When a PDF with a DOI is added, add its reference too. Quiet on failure: the paper is already in. */
export async function fromPaper(projectId: string, sourceId: string, text: string, knownDoi?: string) {
  const doi = knownDoi ?? doiInText(text)
  if (!doi) return null
  try {
    const item = await lookupDoi(doi)
    if (!item) return null
    const { added, existing } = await addItems(projectId, [item], { source: sourceId })
    return added[0] ?? existing[0] ?? null
  } catch (err) {
    console.warn(`Couldn't add a reference for paper ${sourceId}:`, (err as Error).message)
    return null
  }
}

// ---------- citation styles ----------

export interface StyleInfo {
  id: string
  title: string
}

/** A short list shown first, before searching the full style repository. */
export const POPULAR: StyleInfo[] = [
  { id: "apa", title: "APA 7th edition (American Psychological Association)" },
  { id: "modern-language-association", title: "MLA 9th edition (Modern Language Association)" },
  { id: "chicago-author-date", title: "Chicago Manual of Style 18th edition (author-date)" },
  { id: "chicago-notes-bibliography", title: "Chicago Manual of Style 18th edition (notes and bibliography)" },
  { id: "harvard-cite-them-right", title: "Harvard (Cite Them Right)" },
  { id: "ieee", title: "IEEE" },
  { id: "vancouver", title: "Vancouver" },
  { id: "american-medical-association", title: "AMA 11th edition (American Medical Association)" },
  { id: "american-chemical-society", title: "ACS (American Chemical Society)" },
  { id: "american-sociological-association", title: "ASA (American Sociological Association)" },
  { id: "american-political-science-association", title: "APSA (American Political Science Association)" },
  { id: "nature", title: "Nature" },
  { id: "science", title: "Science" },
  { id: "elsevier-harvard", title: "Elsevier Harvard (with titles)" },
  { id: "oscola", title: "OSCOLA (Oxford University Standard for Citation of Legal Authorities)" },
  { id: "bluebook-law-review", title: "Bluebook law review" },
]

let index: StyleInfo[] | null = null

async function styleIndex(): Promise<StyleInfo[]> {
  if (index) return index
  const cached = path.join(CACHE, "styles.json")
  try {
    const st = await fs.stat(cached)
    if (Date.now() - st.mtimeMs < 14 * 86400_000) {
      index = JSON.parse(await fs.readFile(cached, "utf8"))
      return index!
    }
  } catch {}
  try {
    const res = await fetch(STYLE_INDEX, { signal: AbortSignal.timeout(20000) })
    if (!res.ok) throw new Error(String(res.status))
    const raw = (await res.json()) as { name?: string; title?: string; href?: string }[]
    index = raw
      .map((s) => ({ id: s.name ?? s.href?.split("/").pop() ?? "", title: s.title ?? s.name ?? "" }))
      .filter((s) => s.id && s.title)
    await fs.mkdir(CACHE, { recursive: true })
    await fs.writeFile(cached, JSON.stringify(index))
    return index
  } catch {
    // Offline: whatever is cached, or the popular list.
    try {
      index = JSON.parse(await fs.readFile(cached, "utf8"))
      return index!
    } catch {
      return POPULAR
    }
  }
}

export async function findStyles(q: string): Promise<StyleInfo[]> {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return POPULAR
  const all = await styleIndex()
  const seen = new Set<string>()
  const hits: StyleInfo[] = []
  for (const s of [...POPULAR, ...all]) {
    if (seen.has(s.id)) continue
    const hay = `${s.title} ${s.id}`.toLowerCase()
    if (words.every((w) => hay.includes(w))) {
      seen.add(s.id)
      hits.push(s)
    }
    if (hits.length >= 50) break
  }
  return hits
}

const BUILT_IN = new Set(["apa", "vancouver", "harvard1"])
const cslStyles = () => plugins.config.get("@csl").styles as { has: (k: string) => boolean; add: (k: string, v: string) => void }
const cslLocales = () => plugins.config.get("@csl").locales as { has: (k: string) => boolean; add: (k: string, v: string) => void }

async function cachedFetch(url: string, cacheName: string) {
  const f = path.join(CACHE, cacheName)
  try {
    return await fs.readFile(f, "utf8")
  } catch {}
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const text = await res.text()
  await fs.mkdir(CACHE, { recursive: true })
  await fs.writeFile(f, text)
  return text
}

/** Make a style usable: fetch it once (and its parent, for journal styles that borrow another's format). */
async function loadStyle(id: string): Promise<{ key: string; locale?: string }> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new HttpError(400, "Unknown citation style")
  if (BUILT_IN.has(id) || cslStyles().has(id)) return { key: id }
  let xml: string | null
  try {
    xml = (await cachedFetch(`${STYLES_RAW}/${id}.csl`, `${id}.csl`)) ?? (await cachedFetch(`${STYLES_RAW}/dependent/${id}.csl`, `${id}.csl`))
  } catch (err) {
    throw new HttpError(502, `Couldn't download the "${id}" style: ${(err as Error).message}. It needs the internet the first time.`)
  }
  if (!xml) throw new HttpError(404, `No citation style called "${id}"`)
  const locale = /default-locale="([^"]+)"/.exec(xml)?.[1]
  const parent = /<link[^>]+rel="independent-parent"[^>]+href="[^"]*\/styles\/([a-z0-9-]+)"/.exec(xml)?.[1] ??
    /<link[^>]+href="[^"]*\/styles\/([a-z0-9-]+)"[^>]+rel="independent-parent"/.exec(xml)?.[1]
  if (parent) {
    const p = await loadStyle(parent)
    return { key: p.key, locale: locale ?? p.locale }
  }
  cslStyles().add(id, xml)
  return { key: id, locale }
}

/** A citation style as a .csl file on disk, for pandoc. Journal styles resolve to the style they borrow. */
export async function styleFile(id: string): Promise<string | null> {
  if (!/^[a-z0-9-]+$/.test(id)) return null
  try {
    const xml = (await cachedFetch(`${STYLES_RAW}/${id}.csl`, `${id}.csl`)) ?? (await cachedFetch(`${STYLES_RAW}/dependent/${id}.csl`, `${id}.csl`))
    if (!xml) return null
    const parent = /<link[^>]+rel="independent-parent"[^>]+href="[^"]*\/styles\/([a-z0-9-]+)"/.exec(xml)?.[1] ??
      /<link[^>]+href="[^"]*\/styles\/([a-z0-9-]+)"[^>]+rel="independent-parent"/.exec(xml)?.[1]
    return parent ? styleFile(parent) : path.join(CACHE, `${id}.csl`)
  } catch {
    return null
  }
}

async function loadLocale(lang: string) {
  if (cslLocales().has(lang)) return lang
  try {
    const xml = await cachedFetch(`${LOCALES_RAW}/locales-${lang}.xml`, `locales-${lang}.xml`)
    if (xml) {
      cslLocales().add(lang, xml)
      return lang
    }
  } catch {}
  return "en-US"
}

// ---------- export ----------

export type Format = "bibliography" | "citation" | "bibtex" | "ris" | "csljson"

/** citation-js wraps long RIS lines, which breaks most importers. Join them back. */
function unwrapRis(ris: string) {
  return ris.replace(/\r?\n(?![A-Z][A-Z0-9] {2}-|$)/g, "")
}

function toFormat(items: Reference[], format: "bibtex" | "ris" | "csljson") {
  const data = items.map(({ source: _s, addedAt: _a, ...r }) => r)
  if (format === "csljson") return JSON.stringify(data, null, 2)
  // Keep our keys, so \cite{walker2002practice} matches [@walker2002practice] in the notes.
  const cite = new Cite(data.map((r) => ({ ...r, "citation-key": r.id })))
  if (format === "ris") return unwrapRis(cite.format("ris") as string)
  return cite.format("bibtex") as string
}

export async function render(
  projectId: string,
  opts: { ids?: string[]; style: string; format: Format; output?: "html" | "text"; lang?: string },
) {
  const all = await list(projectId)
  const items = opts.ids ? opts.ids.map((id) => all.find((r) => r.id === id)).filter((r): r is Reference => !!r) : all
  if (opts.format === "bibtex" || opts.format === "ris" || opts.format === "csljson") return toFormat(items, opts.format)
  if (!items.length) return ""
  const { key, locale } = await loadStyle(opts.style)
  const lang = await loadLocale(opts.lang ?? locale ?? "en-US")
  const cite = new Cite(items.map(({ source: _s, addedAt: _a, ...r }) => r))
  return cite.format(opts.format, { format: opts.output ?? "html", template: key, lang }) as string
}

/** Citation keys used in a note: pandoc style [@key], [@a; @b, p. 4] and bare @key after a bracket. */
export function citedKeys(markdown: string) {
  const keys = new Set<string>()
  for (const m of markdown.matchAll(/\[([^\]]*@[^\]]*)\]/g)) {
    for (const k of m[1].matchAll(/-?@([\w:.-]*\w)/g)) keys.add(k[1])
  }
  return [...keys]
}
