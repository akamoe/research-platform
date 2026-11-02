import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { extractText, getDocumentProxy, getMeta } from "unpdf"
import { HttpError, PROJECTS_DIR, TRASH_DIR, safeJoin, writeFileAtomic } from "./paths.ts"
import { createNote, getProject, touchProject } from "./projects.ts"

/** A paper the student added. The PDF, its extracted text and this record sit side by side in `sources/`. */
export interface Source {
  id: string
  title: string
  fileName: string
  addedAt: string
  pages: number
  /** The student's reading note for this paper, inside notes/. */
  notePath: string
  /** False when the PDF has no text layer (e.g. a scan), so chat can't read it. */
  hasText: boolean
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

export async function addPdf(projectId: string, fileName: string, bytes: Uint8Array): Promise<Source> {
  await getProject(projectId)
  if (bytes.byteLength > MAX_PDF_BYTES) throw new HttpError(413, "PDF is larger than 200 MB")
  if (Buffer.from(bytes.subarray(0, 5)).toString("latin1") !== "%PDF-") throw new HttpError(400, "That file isn't a PDF")

  const id = crypto.randomUUID().slice(0, 8)
  await fs.mkdir(sourcesDir(projectId), { recursive: true })
  await fs.writeFile(pdfPath(projectId, id), bytes)

  let title = cleanTitle(fileName) || "Untitled paper"
  let pages = 0
  let text = ""
  try {
    // pdf.js may detach the buffer it's given, so hand it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    pages = pdf.numPages
    const meta = await getMeta(pdf).catch(() => null)
    const metaTitle = (meta?.info as { Title?: string } | undefined)?.Title?.trim()
    if (metaTitle && metaTitle.length > 3 && !/^(untitled|microsoft word)/i.test(metaTitle)) title = metaTitle
    const res = await extractText(pdf, { mergePages: false })
    text = (res.text as string[]).map((t, i) => `[page ${i + 1}]\n${t.trim()}`).join("\n\n")
  } catch (err) {
    console.warn(`Could not read text from ${fileName}:`, (err as Error).message)
  }
  await fs.writeFile(file(projectId, id, "txt"), text)
  const hasText = text.replace(/\[page \d+\]/g, "").trim().length > 50

  const notePath = await createNote(
    projectId,
    title.slice(0, 80),
    `# ${title}\n\n## Key points\n\n- \n\n## My questions\n\n- \n`,
    "Papers",
  )
  const source: Source = { id, title, fileName, addedAt: new Date().toISOString(), pages, notePath, hasText }
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

/** Moves the PDF, its record and highlights to the trash. The student's note and captured images stay. */
export async function deleteSource(projectId: string, sourceId: string) {
  await getSource(projectId, sourceId)
  const dest = path.join(TRASH_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${projectId}-paper-${sourceId}`)
  await fs.mkdir(dest, { recursive: true })
  const files = [
    ...(["pdf", "json", "txt"] as const).map((ext) => file(projectId, sourceId, ext)),
    path.join(sourcesDir(projectId), `${sourceId}.highlights.json`),
  ]
  for (const f of files) if (await exists(f)) await fs.rename(f, path.join(dest, path.basename(f)))
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
