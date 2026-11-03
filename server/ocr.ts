import fs from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"
import { HttpError, DATA_DIR } from "./paths.ts"
import * as sources from "./sources.ts"
import { readSettings, writeSettings } from "./settings.ts"

/**
 * OCR for scanned PDF pages, all on this machine: PDFium (the same wasm build the PDF viewer
 * uses) draws each page at 300 dpi, and Tesseract (tesseract.js, also wasm) reads the words.
 * The language files come once from the tessdata_fast repository on GitHub, into
 * `<data>/.tools/tessdata/`. The text replaces the page's empty section in `sources/<id>.txt`,
 * so chat, search, flashcards and the rest can use it.
 */

export const LANGS: { id: string; name: string }[] = [
  { id: "eng", name: "English" },
  { id: "ara", name: "Arabic" },
  { id: "fra", name: "French" },
  { id: "deu", name: "German" },
  { id: "spa", name: "Spanish" },
  { id: "ita", name: "Italian" },
  { id: "por", name: "Portuguese" },
  { id: "tur", name: "Turkish" },
  { id: "fas", name: "Persian" },
  { id: "kmr", name: "Kurdish (Kurmanji)" },
  { id: "rus", name: "Russian" },
  { id: "chi_sim", name: "Chinese (simplified)" },
]
const TESSDATA_DIR = path.join(DATA_DIR, ".tools", "tessdata")
// Pinned to a release so the files never change under the student.
const TESSDATA_URL = process.env.RP_TESSDATA_URL ?? "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0"

const langFile = (id: string) => path.join(TESSDATA_DIR, `${id}.traineddata`)
const has = (p: string) => fs.stat(p).then((s) => s.size > 0, () => false)

export async function installedLangs() {
  const out: string[] = []
  for (const l of LANGS) if (await has(langFile(l.id))) out.push(l.id)
  return out
}

async function ensureLang(id: string) {
  if (!LANGS.some((l) => l.id === id)) throw new HttpError(400, `Unknown OCR language: ${id}`)
  if (await has(langFile(id))) return
  const res = await fetch(`${TESSDATA_URL}/${id}.traineddata`, { headers: { "User-Agent": "Folio" } })
  if (!res.ok) throw new HttpError(502, `Couldn't download the ${LANGS.find((l) => l.id === id)!.name} OCR data (${res.status}). Check your internet connection.`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 100_000) throw new HttpError(502, "The OCR language file looks broken. Try again.")
  await fs.mkdir(TESSDATA_DIR, { recursive: true })
  const tmp = `${langFile(id)}.part`
  await fs.writeFile(tmp, buf)
  await fs.rename(tmp, langFile(id))
}

// ---------- drawing pages with PDFium ----------

type Pdfium = Awaited<ReturnType<typeof import("@embedpdf/pdfium").init>>
let pdfium: Promise<Pdfium> | null = null
function loadPdfium() {
  pdfium ??= (async () => {
    const { init } = await import("@embedpdf/pdfium")
    const wasmPath = createRequire(import.meta.url).resolve("@embedpdf/pdfium/pdfium.wasm")
    const wasm = await fs.readFile(wasmPath)
    const m = await init({ wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) as ArrayBuffer })
    m.PDFiumExt_Init()
    return m
  })()
  return pdfium
}

// The wasm memory; read it again after each call, since it can grow (and move).
const heap = (m: Pdfium) => (m.pdfium as unknown as { HEAPU8: Uint8Array }).HEAPU8

/** Each page as a greyscale PGM image (Tesseract reads those directly). */
async function* renderPages(bytes: Uint8Array, pages: number[]) {
  const m = await loadPdfium()
  const ptr = m.pdfium.wasmExports.malloc(bytes.length)
  heap(m).set(bytes, ptr)
  const doc = m.FPDF_LoadMemDocument(ptr, bytes.length, "")
  try {
    if (!doc) throw new HttpError(422, "PDFium couldn't open this PDF")
    const count = m.FPDF_GetPageCount(doc)
    for (const n of pages) {
      if (n < 1 || n > count) continue
      const page = m.FPDF_LoadPage(doc, n - 1)
      if (!page) continue
      const pw = m.FPDF_GetPageWidthF(page)
      const ph = m.FPDF_GetPageHeightF(page)
      // 300 dpi, but no side over 4200 px (big posters would take ages).
      const scale = Math.min(300 / 72, 4200 / Math.max(pw, ph))
      const w = Math.max(1, Math.round(pw * scale))
      const h = Math.max(1, Math.round(ph * scale))
      const bmp = m.FPDFBitmap_Create(w, h, 0)
      try {
        m.FPDFBitmap_FillRect(bmp, 0, 0, w, h, 0xffffffff)
        // 0x10 = FPDF_ANNOT: draw annotations too (stamps, typed text on scans).
        m.FPDF_RenderPageBitmap(bmp, page, 0, 0, w, h, 0, 0x10)
        const buf = m.FPDFBitmap_GetBuffer(bmp)
        const stride = m.FPDFBitmap_GetStride(bmp)
        const mem = heap(m)
        const head = Buffer.from(`P5\n${w} ${h}\n255\n`)
        const img = Buffer.alloc(head.length + w * h)
        head.copy(img)
        let o = head.length
        for (let y = 0; y < h; y++) {
          let i = buf + y * stride
          // BGRA to grey.
          for (let x = 0; x < w; x++, i += 4) img[o++] = (mem[i] * 29 + mem[i + 1] * 150 + mem[i + 2] * 77) >> 8
        }
        yield { page: n, image: img }
      } finally {
        m.FPDFBitmap_Destroy(bmp)
        m.FPDF_ClosePage(page)
      }
    }
  } finally {
    if (doc) m.FPDF_CloseDocument(doc)
    m.pdfium.wasmExports.free(ptr)
  }
}

/** Tesseract's lines joined back into paragraphs, with words split at line ends put together. */
export function tidy(text: string) {
  return text
    .replace(/\r/g, "")
    // A word split at the end of a line, even when Tesseract put a paragraph break there.
    .replace(/(\p{L})-[ \t]*\n\s*(\p{Ll})/gu, "$1$2")
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .replace(/\s*\n\s*/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim(),
    )
    .filter((p) => p.length > 1)
    .join("\n\n")
}

// ---------- jobs ----------

export interface Job {
  state: "waiting" | "downloading" | "reading" | "done" | "error"
  /** Pages done, and how many to do. */
  done: number
  total: number
  /** The page being read now. */
  page?: number
  langs: string[]
  error?: string
  /** Pages where OCR found no words. */
  empty?: number[]
  finishedAt?: string
}

const jobs = new Map<string, Job>()
let textHook: ((pid: string, src: sources.Source) => unknown) | null = null
/** Called when OCR gives a source with no text its first words (index.ts: references, knowledge base). */
export function onText(fn: (pid: string, src: sources.Source) => unknown) {
  textHook = fn
}
const key = (pid: string, sid: string) => `${pid}/${sid}`
// One at a time: OCR is heavy, and two would only slow each other down.
let queue: Promise<unknown> = Promise.resolve()

export function status(pid: string, sid: string) {
  return jobs.get(key(pid, sid)) ?? null
}

/** Which pages need OCR: the scanned ones, or every page of a PDF with no text at all. */
async function pagesToRead(pid: string, sid: string, all: boolean) {
  const src = await sources.getSource(pid, sid)
  if ((src.type ?? "pdf") !== "pdf") throw new HttpError(400, "OCR is for PDFs")
  const every = Array.from({ length: src.pages }, (_, i) => i + 1)
  if (all) return { src, pages: every }
  if (src.scannedPages?.length) return { src, pages: src.scannedPages }
  if (!src.hasText) return { src, pages: every }
  return { src, pages: [] }
}

export async function start(pid: string, sid: string, langs: string[], opts: { all?: boolean } = {}) {
  const k = key(pid, sid)
  const running = jobs.get(k)
  if (running && (running.state === "waiting" || running.state === "downloading" || running.state === "reading")) return running
  const clean = [...new Set(langs)].filter((l) => LANGS.some((x) => x.id === l))
  if (!clean.length) throw new HttpError(400, "Pick a language")
  const { pages } = await pagesToRead(pid, sid, !!opts.all)
  if (!pages.length) throw new HttpError(400, "Every page of this PDF already has text")
  const job: Job = { state: "waiting", done: 0, total: pages.length, langs: clean }
  jobs.set(k, job)
  // Remember the languages: new scans are then read by themselves.
  readSettings()
    .then((s) => (s.ocrLangs?.join("+") === clean.join("+") ? null : writeSettings({ ...s, ocrLangs: clean })))
    .catch(() => {})
  queue = queue.then(() => run(pid, sid, pages, job)).catch(() => {})
  return job
}

async function run(pid: string, sid: string, pages: number[], job: Job) {
  let worker: import("tesseract.js").Worker | null = null
  try {
    job.state = "downloading"
    for (const l of job.langs) await ensureLang(l)
    job.state = "reading"
    const { createWorker } = await import("tesseract.js")
    worker = await createWorker(job.langs.join("+"), 1, {
      langPath: TESSDATA_DIR,
      gzip: false,
      cacheMethod: "none",
      logger: () => {},
      errorHandler: () => {},
    })
    const before = await sources.getSource(pid, sid)
    const bytes = new Uint8Array(await fs.readFile(sources.pdfPath(pid, sid)))
    const got = new Map<number, string>()
    const empty: number[] = []
    for await (const { page, image } of renderPages(bytes, pages)) {
      job.page = page
      const r = await worker.recognize(image)
      const text = tidy(r.data.text)
      if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 3) empty.push(page)
      else got.set(page, text)
      job.done++
      // Save as it goes, so a long scan is usable before it's finished.
      if (job.done % 5 === 0) await save(pid, sid, got, job, false)
    }
    job.empty = empty
    const after = await save(pid, sid, got, job, true)
    job.state = "done"
    if (!before.hasText && after.hasText) await Promise.resolve(textHook?.(pid, after)).catch(() => {})
  } catch (err) {
    job.state = "error"
    job.error = (err as Error).message
  } finally {
    job.finishedAt = new Date().toISOString()
    await worker?.terminate().catch(() => {})
  }
}

async function save(pid: string, sid: string, got: Map<number, string>, job: Job, last: boolean) {
  const src = await sources.getSource(pid, sid)
  const read = new Set(got.keys())
  const ocrPages = [...new Set([...(src.ocrPages ?? []), ...read])].sort((a, b) => a - b)
  // Pages OCR read are no longer scans. Pages where it found no words (blank pages, or only a
  // picture) are left out too once it's done, so Folio stops saying they can't be read.
  const tried = new Set([...read, ...(job.empty ?? [])])
  const scanned = (src.scannedPages ?? []).filter((p) => !tried.has(p))
  return sources.replacePages(pid, sid, got, { ocrPages, ocrLangs: job.langs, scannedPages: last ? scanned : src.scannedPages })
}

/** After a scanned PDF is added: read it if the student has used OCR before (the data is here). */
export async function auto(pid: string, src: sources.Source) {
  if (!src.scannedPages?.length && src.hasText) return
  const s = await readSettings()
  const langs = s.ocrLangs ?? []
  if (!langs.length) return
  const have = await installedLangs()
  if (!langs.every((l) => have.includes(l))) return
  await start(pid, src.id, langs).catch(() => {})
}
