import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { extractText, getDocumentProxy, getMeta } from "unpdf"
import { HttpError, PROJECTS_DIR, TRASH_DIR, safeJoin, writeFileAtomic } from "./paths.ts"
import { createNote, getProject, touchProject } from "./projects.ts"

export type SourceType = "pdf" | "web" | "youtube" | "text" | "docx"

/**
 * Something the student added to read: a PDF, a web page, a YouTube video, a Word file or pasted text.
 * The original (for PDFs and Word files), its text and this record sit side by side in `sources/`.
 */
export interface Source {
  id: string
  title: string
  /** Missing means "pdf" (sources from before other kinds existed). */
  type?: SourceType
  /** Where a web page or video came from. */
  url?: string
  author?: string
  fileName: string
  addedAt: string
  pages: number
  /** The student's reading note for this paper, inside notes/. */
  notePath: string
  /** False when the PDF has no text layer (e.g. a scan), so chat can't read it. */
  hasText: boolean
  /** PDF pages (1-based) that are pictures of text, like scans, so their words can't be read yet. */
  scannedPages?: number[]
  /** What read the PDF's text; missing means the older pdf.js reader. */
  extractor?: "pdf-inspector" | "pdf.js"
  /** False when the student left this paper out of the project chat. Missing means included. */
  inChat?: boolean
}

export const MAX_PDF_BYTES = 200 * 1024 * 1024

function sourcesDir(projectId: string) {
  if (!/^[\w-]+$/.test(projectId)) throw new HttpError(400, "Invalid project id")
  return path.join(safeJoin(PROJECTS_DIR, projectId), "sources")
}

function file(projectId: string, sourceId: string, ext: "pdf" | "json" | "txt") {
  if (!/^[\w-]+$/.test(sourceId)) throw new HttpError(400, "Invalid paper id")
  return path.join(sourcesDir(projectId), `${sourceId}.${ext}`)
}

const exists = (p: string) => fs.stat(p).then(() => true, () => false)

export async function listSources(projectId: string): Promise<Source[]> {
  await getProject(projectId)
  const dir = sourcesDir(projectId)
  await fs.mkdir(dir, { recursive: true })
  const out: Source[] = []
  for (const f of await fs.readdir(dir)) {
    // <id>.json is the paper's metadata; <id>.highlights.json and friends are not.
    if (!/^[\w-]+\.json$/.test(f) || f.includes(".highlights.")) continue
    try {
      const s = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"))
      if (s && typeof s === "object" && !Array.isArray(s) && s.id) out.push(s)
    } catch {}
  }
  return out.sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

export async function getSource(projectId: string, sourceId: string): Promise<Source> {
  const f = file(projectId, sourceId, "json")
  if (!(await exists(f))) throw new HttpError(404, "Paper not found")
  return JSON.parse(await fs.readFile(f, "utf8"))
}

async function saveSource(projectId: string, s: Source) {
  await writeFileAtomic(file(projectId, s.id, "json"), JSON.stringify(s, null, 2))
}

export function pdfPath(projectId: string, sourceId: string) {
  return file(projectId, sourceId, "pdf")
}

export async function sourceText(projectId: string, sourceId: string) {
  try {
    return await fs.readFile(file(projectId, sourceId, "txt"), "utf8")
  } catch {
    return ""
  }
}

function cleanTitle(s: string) {
  return s.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim()
}

// ---------- reading a PDF's text ----------

type Inspector = typeof import("@firecrawl/pdf-inspector")
let inspector: Promise<Inspector | null> | null = null
/** pdf-inspector is native code; where it has no build (e.g. Intel Macs) Folio uses pdf.js instead. */
function loadInspector() {
  // RP_PDF_READER=pdf.js turns pdf-inspector off.
  if (process.env.RP_PDF_READER === "pdf.js") return Promise.resolve(null)
  inspector ??= import("@firecrawl/pdf-inspector").then(
    (m) => m,
    (err: Error) => {
      console.warn(`pdf-inspector isn't available here, reading PDFs with pdf.js (${err.message.split("\n")[0]})`)
      return null
    },
  )
  return inspector
}

export interface PdfText {
  pages: number
  title?: string
  /** Each page as "[page N]" then its text (markdown from pdf-inspector: headings, paragraphs, tables). */
  text: string
  scannedPages: number[]
  extractor: "pdf-inspector" | "pdf.js"
}

const usableTitle = (t?: string) => {
  const s = t?.trim()
  return s && s.length > 3 && !/^(untitled|microsoft word)/i.test(s) ? s : undefined
}
const readable = (text: string) => text.replace(/\[page \d+\]/g, "").trim().length > 50

/**
 * pdf-inspector first: it is fast, keeps reading order in two-column papers, joins lines into
 * paragraphs, marks headings and tables, and tells scanned pages apart. pdf.js is the fallback.
 */
export async function readPdf(bytes: Uint8Array): Promise<PdfText> {
  const ins = await loadInspector()
  if (ins) {
    try {
      const buf = Buffer.from(bytes)
      const info = ins.detectPdf(buf)
      const res = await ins.extractPagesMarkdownAsync(buf)
      const text = res.pages.map((p) => `[page ${p.page + 1}]\n${p.markdown.trim()}`).join("\n\n")
      const scannedPages = [...new Set(res.pagesNeedingOcr)].sort((a, b) => a - b)
      // A page count of scans explains empty text; otherwise empty text means the reader struggled.
      if (readable(text) || scannedPages.length >= info.pageCount)
        return { pages: info.pageCount, title: usableTitle(info.title), text, scannedPages, extractor: "pdf-inspector" }
    } catch (err) {
      console.warn("pdf-inspector couldn't read this PDF, trying pdf.js:", (err as Error).message)
    }
  }
  // pdf.js may detach the buffer it's given, so hand it a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const meta = await getMeta(pdf).catch(() => null)
  const res = await extractText(pdf, { mergePages: false })
  return {
    pages: pdf.numPages,
    title: usableTitle((meta?.info as { Title?: string } | undefined)?.Title),
    text: (res.text as string[]).map((t, i) => `[page ${i + 1}]\n${t.trim()}`).join("\n\n"),
    scannedPages: [],
    extractor: "pdf.js",
  }
}

/**
 * PDFs added before pdf-inspector was in Folio: read their text again with it, once.
 * Only the derived text file changes; the PDF, highlights and notes stay as they are.
 */
export async function upgradePdfText(projectId: string) {
  const ins = await loadInspector()
  if (!ins) return 0
  let n = 0
  for (const src of await listSources(projectId)) {
    if ((src.type ?? "pdf") !== "pdf" || src.extractor) continue
    try {
      const got = await readPdf(new Uint8Array(await fs.readFile(pdfPath(projectId, src.id))))
      await fs.writeFile(file(projectId, src.id, "txt"), got.text)
      await saveSource(projectId, {
        ...src,
        pages: got.pages || src.pages,
        hasText: readable(got.text),
        scannedPages: got.scannedPages,
        extractor: got.extractor,
      })
      n++
    } catch (err) {
      console.warn(`Couldn't re-read ${src.title}:`, (err as Error).message)
    }
  }
  return n
}

export async function addPdf(projectId: string, fileName: string, bytes: Uint8Array): Promise<Source> {
  await getProject(projectId)
  if (bytes.byteLength > MAX_PDF_BYTES) throw new HttpError(413, "PDF is larger than 200 MB")
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new HttpError(400, "That file isn't a PDF")

  const id = crypto.randomUUID().slice(0, 8)
  await fs.mkdir(sourcesDir(projectId), { recursive: true })
  await fs.writeFile(pdfPath(projectId, id), bytes)

  let title = cleanTitle(fileName) || "Untitled paper"
  let got: PdfText = { pages: 0, text: "", scannedPages: [], extractor: "pdf.js" }
  try {
    got = await readPdf(bytes)
    if (got.title) title = got.title
  } catch (err) {
    console.warn(`Could not read text from ${fileName}:`, (err as Error).message)
  }
  await fs.writeFile(file(projectId, id, "txt"), got.text)

  const notePath = await readingNote(projectId, title)
  const source: Source = {
    id,
    title,
    type: "pdf",
    fileName,
    addedAt: new Date().toISOString(),
    pages: got.pages,
    notePath,
    hasText: readable(got.text),
    scannedPages: got.scannedPages,
    extractor: got.extractor,
  }
  await saveSource(projectId, source)
  await touchProject(projectId)
  return source
}

function readingNote(projectId: string, title: string) {
  return createNote(projectId, title.slice(0, 80), `# ${title}\n\n## Key points\n\n- \n\n## My questions\n\n- \n`, "Papers")
}

const MAX_TEXT = 5_000_000

/** A source that is only text: a web page, a video transcript, a Word file or something pasted. */
export async function addTextSource(
  projectId: string,
  input: {
    type: Exclude<SourceType, "pdf">
    title: string
    text: string
    url?: string
    author?: string
    fileName?: string
    /** The original file (Word), kept next to the text. */
    original?: { bytes: Uint8Array; ext: string }
  },
): Promise<Source> {
  await getProject(projectId)
  const text = input.text.replace(/\r\n?/g, "\n").trim()
  if (!text) throw new HttpError(400, "There's no text to add")
  if (text.length > MAX_TEXT) throw new HttpError(413, "That text is too long (over 5 million characters)")
  const id = crypto.randomUUID().slice(0, 8)
  await fs.mkdir(sourcesDir(projectId), { recursive: true })
  if (input.original) {
    if (!/^[a-z0-9]{1,8}$/.test(input.original.ext)) throw new HttpError(400, "Invalid file type")
    await fs.writeFile(path.join(sourcesDir(projectId), `${id}.original.${input.original.ext}`), input.original.bytes)
  }
  await fs.writeFile(file(projectId, id, "txt"), text)
  const title = input.title.replace(/\s+/g, " ").trim().slice(0, 300) || "Untitled source"
  const notePath = await readingNote(projectId, title)
  const source: Source = {
    id,
    title,
    type: input.type,
    ...(input.url ? { url: input.url } : {}),
    ...(input.author ? { author: input.author.slice(0, 200) } : {}),
    fileName: input.fileName ?? "",
    addedAt: new Date().toISOString(),
    pages: 0,
    notePath,
    hasText: text.length > 20,
  }
  await saveSource(projectId, source)
  await touchProject(projectId)
  return source
}

export async function updateSource(projectId: string, sourceId: string, patch: { title?: string; inChat?: boolean }) {
  const s = await getSource(projectId, sourceId)
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw new HttpError(400, "Title is required")
    s.title = patch.title.trim()
  }
  if (patch.inChat !== undefined) {
    if (patch.inChat) delete s.inChat
    else s.inChat = false
  }
  await saveSource(projectId, s)
  return s
}

/** Moves the source's files, record and highlights to the trash. The student's note and captured images stay. */
export async function deleteSource(projectId: string, sourceId: string) {
  await getSource(projectId, sourceId)
  const dest = path.join(TRASH_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${projectId}-paper-${sourceId}`)
  await fs.mkdir(dest, { recursive: true })
  const dir = sourcesDir(projectId)
  // <id>.pdf, .json, .txt, .highlights.json, .original.docx; not the <id>-assets folder of captured images.
  for (const f of await fs.readdir(dir))
    if (f.startsWith(`${sourceId}.`)) await fs.rename(path.join(dir, f), path.join(dest, f))
  // Images stay where they are, so notes that embed them keep working.
}

// ---------- highlights ----------

export interface PdfRect {
  origin: { x: number; y: number }
  size: { width: number; height: number }
}

/** A highlight on a paper. Coordinates are PDF points, so they don't depend on zoom. */
export interface Highlight {
  id: string
  pageIndex: number
  rects: PdfRect[]
  color: string
  /** Selected text, for text highlights. */
  text?: string
  /** File name in the paper's assets folder, for area (image) highlights. */
  image?: string
  createdAt: string
}

const COLORS = new Set(["yellow", "green", "blue", "red", "purple"])

function highlightsFile(projectId: string, sourceId: string) {
  if (!/^[\w-]+$/.test(sourceId)) throw new HttpError(400, "Invalid paper id")
  return path.join(sourcesDir(projectId), `${sourceId}.highlights.json`)
}

export function assetsDir(projectId: string, sourceId: string) {
  if (!/^[\w-]+$/.test(sourceId)) throw new HttpError(400, "Invalid paper id")
  return path.join(sourcesDir(projectId), `${sourceId}-assets`)
}

export async function listHighlights(projectId: string, sourceId: string): Promise<Highlight[]> {
  await getSource(projectId, sourceId)
  try {
    return JSON.parse(await fs.readFile(highlightsFile(projectId, sourceId), "utf8"))
  } catch {
    return []
  }
}

async function saveHighlights(projectId: string, sourceId: string, list: Highlight[]) {
  await fs.writeFile(highlightsFile(projectId, sourceId), JSON.stringify(list, null, 2))
}

function checkRects(rects: unknown): PdfRect[] {
  if (!Array.isArray(rects) || rects.length === 0 || rects.length > 500) throw new HttpError(400, "Invalid highlight area")
  return rects.map((r) => {
    const x = Number(r?.origin?.x), y = Number(r?.origin?.y), w = Number(r?.size?.width), h = Number(r?.size?.height)
    if (![x, y, w, h].every(Number.isFinite)) throw new HttpError(400, "Invalid highlight area")
    return { origin: { x, y }, size: { width: w, height: h } }
  })
}

export async function addHighlight(
  projectId: string,
  sourceId: string,
  input: { pageIndex: number; rects: unknown; color: string; text?: string; image?: Uint8Array },
): Promise<Highlight> {
  const list = await listHighlights(projectId, sourceId)
  if (!COLORS.has(input.color)) throw new HttpError(400, "Unknown color")
  if (!Number.isInteger(input.pageIndex) || input.pageIndex < 0) throw new HttpError(400, "Invalid page")
  const h: Highlight = {
    id: crypto.randomUUID().slice(0, 8),
    pageIndex: input.pageIndex,
    rects: checkRects(input.rects),
    color: input.color,
    createdAt: new Date().toISOString(),
  }
  if (input.text) h.text = input.text.slice(0, 20000)
  if (input.image) {
    const dir = assetsDir(projectId, sourceId)
    await fs.mkdir(dir, { recursive: true })
    h.image = `${h.id}.png`
    await fs.writeFile(path.join(dir, h.image), input.image)
  }
  list.push(h)
  await saveHighlights(projectId, sourceId, list)
  return h
}

export async function updateHighlight(projectId: string, sourceId: string, id: string, patch: { color?: string }) {
  const list = await listHighlights(projectId, sourceId)
  const h = list.find((x) => x.id === id)
  if (!h) throw new HttpError(404, "Highlight not found")
  if (patch.color !== undefined) {
    if (!COLORS.has(patch.color)) throw new HttpError(400, "Unknown color")
    h.color = patch.color
  }
  await saveHighlights(projectId, sourceId, list)
  return h
}

/** Removes the highlight mark. Its image stays in the assets folder so notes that show it don't break. */
export async function deleteHighlight(projectId: string, sourceId: string, id: string) {
  const list = await listHighlights(projectId, sourceId)
  await saveHighlights(projectId, sourceId, list.filter((x) => x.id !== id))
}

export async function readAsset(projectId: string, sourceId: string, file: string) {
  if (!/^[\w-]+\.png$/.test(file)) throw new HttpError(400, "Invalid file")
  try {
    return await fs.readFile(path.join(assetsDir(projectId, sourceId), file))
  } catch {
    throw new HttpError(404, "Image not found")
  }
}
