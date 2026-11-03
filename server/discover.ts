import { DOMParser } from "linkedom"
import { HttpError } from "./paths.ts"

/**
 * Finding papers outside the library: OpenAlex (which also carries Unpaywall's open-access
 * links), Semantic Scholar, arXiv and Crossref. All free and keyless. Results come back in one
 * shape so the UI doesn't care where they came from.
 */

const OPENALEX = process.env.RP_OPENALEX_URL ?? "https://api.openalex.org"
const S2 = process.env.RP_S2_URL ?? "https://api.semanticscholar.org"
const ARXIV = process.env.RP_ARXIV_URL ?? "https://export.arxiv.org"
const CROSSREF = process.env.RP_CROSSREF_URL ?? "https://api.crossref.org"
const UA = "Folio/0.1 (local research app; https://github.com/akamoe/research-platform)"

export type Provider = "openalex" | "s2" | "arxiv" | "crossref"
export const PROVIDER_NAMES: Record<Provider, string> = {
  openalex: "OpenAlex",
  s2: "Semantic Scholar",
  arxiv: "arXiv",
  crossref: "Crossref",
}

export interface Work {
  /** "openalex:W123", "s2:<paperId>", "arxiv:2101.00001" or "doi:10.x/y". */
  key: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  abstract?: string
  citedBy?: number
  /** A page about the paper. */
  url?: string
  /** A free PDF, when one is known. */
  pdfUrl?: string
  type?: string
  from: Provider[]
}

export interface SearchOptions {
  provider?: Provider | "all"
  yearFrom?: number
  yearTo?: number
  openAccess?: boolean
  limit?: number
}

async function get(url: string, accept = "application/json") {
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: accept, "User-Agent": UA }, signal: AbortSignal.timeout(20000) })
  } catch (err) {
    throw new HttpError(502, `Couldn't reach ${new URL(url).host}: ${(err as Error).message}. Check your internet connection.`)
  }
  if (res.status === 429) throw new HttpError(429, `${new URL(url).host} is busy right now. Try again in a minute.`)
  if (res.status === 404) return null
  if (!res.ok) throw new HttpError(502, `${new URL(url).host} answered ${res.status}.`)
  return res
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = async (url: string): Promise<any> => (await get(url))?.json() ?? null

const normDoi = (d?: string | null) =>
  d ? d.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:/i, "").trim().toLowerCase() || undefined : undefined
const normTitle = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim()
const clean = (s?: string | null) => s?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined

// ---------- OpenAlex ----------

/** OpenAlex keeps abstracts as word -> positions; put the words back in order. */
function abstractFrom(inv?: Record<string, number[]> | null) {
  if (!inv) return undefined
  const words: string[] = []
  for (const [w, at] of Object.entries(inv)) for (const i of at) words[i] = w
  return words.filter(Boolean).join(" ") || undefined
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromOpenAlex(w: any): Work {
  const doi = normDoi(w.doi)
  const pdf = w.best_oa_location?.pdf_url ?? w.primary_location?.pdf_url ?? w.open_access?.oa_url ?? undefined
  return {
    key: `openalex:${String(w.id).split("/").pop()}`,
    title: clean(w.display_name ?? w.title) ?? "Untitled",
    authors: (w.authorships ?? []).map((a: { author?: { display_name?: string } }) => a.author?.display_name).filter(Boolean),
    year: w.publication_year ?? undefined,
    venue: w.primary_location?.source?.display_name ?? undefined,
    doi,
    abstract: abstractFrom(w.abstract_inverted_index),
    citedBy: w.cited_by_count ?? undefined,
    url: doi ? `https://doi.org/${doi}` : w.id,
    pdfUrl: typeof pdf === "string" && /\.pdf($|\?)|arxiv\.org\/pdf|\/pdf\//i.test(pdf) ? pdf : w.best_oa_location?.pdf_url ?? undefined,
    type: w.type ?? undefined,
    from: ["openalex"],
  }
}

function openAlexFilter(o: SearchOptions) {
  const f: string[] = []
  if (o.yearFrom) f.push(`from_publication_date:${o.yearFrom}-01-01`)
  if (o.yearTo) f.push(`to_publication_date:${o.yearTo}-12-31`)
  if (o.openAccess) f.push("is_oa:true")
  return f
}

async function searchOpenAlex(q: string, o: SearchOptions) {
  const filter = openAlexFilter(o)
  const url = `${OPENALEX}/works?search=${encodeURIComponent(q)}&per-page=${o.limit ?? 20}${filter.length ? `&filter=${filter.join(",")}` : ""}`
  const data = await json(url)
  return ((data?.results ?? []) as unknown[]).map(fromOpenAlex)
}

/** The OpenAlex id for a work, from its key or DOI. */
async function openAlexId(w: Pick<Work, "key" | "doi">) {
  if (w.key.startsWith("openalex:")) return w.key.slice(9)
  if (!w.doi) return null
  const data = await json(`${OPENALEX}/works/doi:${encodeURIComponent(w.doi)}`)
  return data?.id ? String(data.id).split("/").pop()! : null
}

// ---------- Semantic Scholar ----------

const S2_FIELDS = "title,year,authors,venue,externalIds,citationCount,openAccessPdf,abstract,url,publicationTypes"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fromS2(p: any): Work {
  const doi = normDoi(p.externalIds?.DOI)
  const arxivId = p.externalIds?.ArXiv ?? undefined
  return {
    key: `s2:${p.paperId}`,
    title: clean(p.title) ?? "Untitled",
    authors: (p.authors ?? []).map((a: { name?: string }) => a.name).filter(Boolean),
    year: p.year ?? undefined,
    venue: p.venue || undefined,
    doi,
    arxivId,
    abstract: clean(p.abstract),
    citedBy: p.citationCount ?? undefined,
    url: p.url ?? undefined,
    pdfUrl: p.openAccessPdf?.url || (arxivId ? `https://arxiv.org/pdf/${arxivId}` : undefined),
    from: ["s2"],
  }
}

async function searchS2(q: string, o: SearchOptions) {
  const year = o.yearFrom || o.yearTo ? `&year=${o.yearFrom ?? ""}-${o.yearTo ?? ""}` : ""
  const oa = o.openAccess ? "&openAccessPdf" : ""
  const data = await json(`${S2}/graph/v1/paper/search?query=${encodeURIComponent(q)}&limit=${o.limit ?? 20}&fields=${S2_FIELDS}${year}${oa}`)
  return ((data?.data ?? []) as unknown[]).map(fromS2)
}

function s2Id(w: Pick<Work, "key" | "doi" | "arxivId">) {
  if (w.key.startsWith("s2:")) return w.key.slice(3)
  if (w.doi) return `DOI:${w.doi}`
  if (w.arxivId) return `ARXIV:${w.arxivId}`
  return null
}

// ---------- arXiv ----------

async function searchArxiv(q: string, o: SearchOptions) {
  const terms = q.trim().split(/\s+/).map((t) => `all:${t}`).join("+AND+")
  const res = await get(`${ARXIV}/api/query?search_query=${encodeURIComponent(terms).replace(/%2B/g, "+")}&max_results=${o.limit ?? 20}`, "application/atom+xml")
  if (!res) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type El = any
  const doc: El = new DOMParser().parseFromString(await res.text(), "text/xml")
  const text = (el: El, tag: string): string | undefined => el?.getElementsByTagName(tag)[0]?.textContent ?? undefined
  const works = (Array.from(doc.getElementsByTagName("entry")) as El[]).map((e): Work => {
    const id = (text(e, "id") ?? "").split("/abs/").pop()?.replace(/v\d+$/, "") ?? ""
    const links = Array.from(e.getElementsByTagName("link")) as El[]
    const pdf: string = links.find((l) => l.getAttribute("title") === "pdf")?.getAttribute("href") ?? `https://arxiv.org/pdf/${id}`
    return {
      key: `arxiv:${id}`,
      title: clean(text(e, "title")) ?? "Untitled",
      authors: (Array.from(e.getElementsByTagName("author")) as El[]).map((a) => clean(text(a, "name"))!).filter(Boolean),
      year: Number(text(e, "published")?.slice(0, 4)) || undefined,
      venue: clean(text(e, "arxiv:journal_ref")) ?? "arXiv",
      doi: normDoi(text(e, "arxiv:doi")),
      arxivId: id,
      abstract: clean(text(e, "summary")),
      url: `https://arxiv.org/abs/${id}`,
      pdfUrl: pdf.replace(/^http:\/\/arxiv\.org/, "https://arxiv.org"),
      type: "preprint",
      from: ["arxiv"],
    }
  })
  return works.filter((w) => (!o.yearFrom || (w.year ?? 0) >= o.yearFrom) && (!o.yearTo || (w.year ?? 9999) <= o.yearTo))
}

// ---------- Crossref ----------

async function searchCrossref(q: string, o: SearchOptions) {
  const f: string[] = []
  if (o.yearFrom) f.push(`from-pub-date:${o.yearFrom}`)
  if (o.yearTo) f.push(`until-pub-date:${o.yearTo}`)
  const data = await json(
    `${CROSSREF}/works?query.bibliographic=${encodeURIComponent(q)}&rows=${o.limit ?? 20}${f.length ? `&filter=${f.join(",")}` : ""}&select=DOI,title,author,issued,container-title,type,abstract,is-referenced-by-count,URL`,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const works = ((data?.message?.items ?? []) as any[]).map((it): Work => {
    const doi = normDoi(it.DOI)
    return {
      key: `doi:${doi}`,
      title: clean(it.title?.[0]) ?? "Untitled",
      authors: (it.author ?? []).map((a: { given?: string; family?: string; name?: string }) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
      year: it.issued?.["date-parts"]?.[0]?.[0] ?? undefined,
      venue: it["container-title"]?.[0] ?? undefined,
      doi,
      abstract: clean(it.abstract),
      citedBy: it["is-referenced-by-count"] ?? undefined,
      url: doi ? `https://doi.org/${doi}` : it.URL,
      // Crossref "links" are often behind a paywall, so they don't count as open access.
      pdfUrl: undefined,
      type: it.type,
      from: ["crossref"],
    }
  })
  return o.openAccess ? [] : works
}

// ---------- together ----------

const SEARCHERS: Record<Provider, (q: string, o: SearchOptions) => Promise<Work[]>> = {
  openalex: searchOpenAlex,
  s2: searchS2,
  arxiv: searchArxiv,
  crossref: searchCrossref,
}

/** One list from several sources: the same paper (DOI, arXiv id or title + year) appears once, with what each source knew. */
export function merge(lists: Work[][]): Work[] {
  const out: Work[] = []
  const find = (w: Work) =>
    out.find(
      (x) =>
        (w.doi && x.doi === w.doi) ||
        (w.arxivId && x.arxivId === w.arxivId) ||
        (normTitle(x.title) === normTitle(w.title) && (!x.year || !w.year || Math.abs(x.year - w.year) <= 1)),
    )
  // Take the first result of each list, then the second, so every source is near the top.
  const longest = Math.max(0, ...lists.map((l) => l.length))
  for (let i = 0; i < longest; i++)
    for (const list of lists) {
      const w = list[i]
      if (!w) continue
      const x = find(w)
      if (!x) {
        out.push({ ...w })
        continue
      }
      x.from = [...new Set([...x.from, ...w.from])]
      x.doi ??= w.doi
      x.arxivId ??= w.arxivId
      x.abstract ??= w.abstract
      x.pdfUrl ??= w.pdfUrl
      x.venue ??= w.venue
      x.citedBy = Math.max(x.citedBy ?? 0, w.citedBy ?? 0) || undefined
    }
  return out
}

export async function search(q: string, o: SearchOptions = {}) {
  if (!q.trim()) return { works: [], failed: [] as string[] }
  const providers: Provider[] = !o.provider || o.provider === "all" ? ["openalex", "s2", "arxiv"] : [o.provider]
  const settled = await Promise.allSettled(providers.map((p) => SEARCHERS[p](q, o)))
  const failed = providers.filter((_, i) => settled[i].status === "rejected")
  if (failed.length === providers.length) throw (settled[0] as PromiseRejectedResult).reason
  const lists = settled.map((s) => (s.status === "fulfilled" ? s.value : []))
  let works = merge(lists)
  if (o.openAccess) works = works.filter((w) => w.pdfUrl)
  return { works, failed: failed.map((p) => PROVIDER_NAMES[p]) }
}

export type Relation = "related" | "citing" | "references"

/** Papers that cite this one, that it cites, or that are like it. OpenAlex first, Semantic Scholar as a fallback. */
export async function around(seed: Pick<Work, "key" | "doi" | "arxivId">, rel: Relation): Promise<Work[]> {
  const oa = await openAlexId(seed).catch(() => null)
  if (oa) {
    const filter = rel === "citing" ? `cites:${oa}` : rel === "references" ? `cited_by:${oa}` : `related_to:${oa}`
    const sort = rel === "citing" ? "&sort=cited_by_count:desc" : ""
    const data = await json(`${OPENALEX}/works?filter=${filter}&per-page=25${sort}`).catch(() => null)
    if (data?.results?.length) return (data.results as unknown[]).map(fromOpenAlex)
  }
  const id = s2Id(seed)
  if (!id) return []
  if (rel === "related") {
    const data = await json(`${S2}/recommendations/v1/papers/forpaper/${encodeURIComponent(id)}?limit=25&fields=${S2_FIELDS}`)
    return ((data?.recommendedPapers ?? []) as unknown[]).map(fromS2)
  }
  const data = await json(`${S2}/graph/v1/paper/${encodeURIComponent(id)}/${rel === "citing" ? "citations" : "references"}?limit=25&fields=${S2_FIELDS}`)
  return ((data?.data ?? []) as { citingPaper?: unknown; citedPaper?: unknown }[])
    .map((d) => d.citingPaper ?? d.citedPaper)
    .filter((p): p is { paperId: string } => !!(p as { paperId?: string } | undefined)?.paperId)
    .map(fromS2)
}

/** A free PDF for this paper, if any source knows one. */
export async function findPdf(w: Pick<Work, "key" | "doi" | "arxivId" | "pdfUrl">): Promise<string | null> {
  if (w.pdfUrl) return w.pdfUrl
  if (w.arxivId) return `https://arxiv.org/pdf/${w.arxivId}`
  if (w.doi) {
    const oa = await json(`${OPENALEX}/works/doi:${encodeURIComponent(w.doi)}`).catch(() => null)
    const pdf = oa?.best_oa_location?.pdf_url ?? oa?.primary_location?.pdf_url
    if (pdf) return pdf
  }
  const id = s2Id(w)
  if (id) {
    const p = await json(`${S2}/graph/v1/paper/${encodeURIComponent(id)}?fields=openAccessPdf,externalIds`).catch(() => null)
    if (p?.openAccessPdf?.url) return p.openAccessPdf.url
    if (p?.externalIds?.ArXiv) return `https://arxiv.org/pdf/${p.externalIds.ArXiv}`
  }
  return null
}

/** A CSL item for the library, when the DOI can't be looked up. */
export function toCsl(w: Work): Record<string, unknown> {
  return {
    type: w.type === "preprint" || w.from.includes("arxiv") ? "article" : w.type === "proceedings-article" ? "paper-conference" : "article-journal",
    title: w.title,
    author: w.authors.map((name) => {
      const parts = name.trim().split(/\s+/)
      return parts.length > 1 ? { given: parts.slice(0, -1).join(" "), family: parts[parts.length - 1] } : { literal: name }
    }),
    issued: w.year ? { "date-parts": [[w.year]] } : undefined,
    "container-title": w.venue && w.venue !== "arXiv" ? w.venue : undefined,
    publisher: w.from.includes("arxiv") && !w.doi ? "arXiv" : undefined,
    DOI: w.doi,
    URL: w.url,
    abstract: w.abstract,
    number: w.arxivId && !w.doi ? `arXiv:${w.arxivId}` : undefined,
  }
}
