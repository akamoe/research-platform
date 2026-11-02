import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { extractText, getDocumentProxy, getMeta } from "unpdf"
import { HttpError, PROJECTS_DIR, TRASH_DIR, safeJoin } from "./paths.ts"
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
    if (!f.endsWith(".json")) continue
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, f), "utf8")))
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
  await fs.writeFile(file(projectId, s.id, "json"), JSON.stringify(s, null, 2))
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

export async function renameSource(projectId: string, sourceId: string, title: string) {
  const s = await getSource(projectId, sourceId)
  if (!title.trim()) throw new HttpError(400, "Title is required")
  s.title = title.trim()
  await saveSource(projectId, s)
  return s
}

/** Moves the PDF and its record to the trash. The student's note stays in notes/. */
export async function deleteSource(projectId: string, sourceId: string) {
  await getSource(projectId, sourceId)
  const dest = path.join(TRASH_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${projectId}-paper-${sourceId}`)
  await fs.mkdir(dest, { recursive: true })
  for (const ext of ["pdf", "json", "txt"] as const) {
    const f = file(projectId, sourceId, ext)
    if (await exists(f)) await fs.rename(f, path.join(dest, path.basename(f)))
  }
}
