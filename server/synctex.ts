import fs from "node:fs/promises"
import path from "node:path"
import zlib from "node:zlib"
import { promisify } from "node:util"
import { HttpError } from "./paths.ts"
import * as latex from "./latex.ts"

/**
 * SyncTeX without the synctex program (Tectonic users don't have it): reads the
 * `main.synctex.gz` that latexmk (-synctex=1) or Tectonic (--synctex) writes next to the PDF,
 * and maps a line of a .tex file to boxes on a PDF page, and a point on a page back to a line.
 * Positions are PDF points from the top-left corner of the page.
 */

interface Rec {
  kind: string
  page: number
  file: string | null
  line: number
  /** Left edge and baseline. */
  x: number
  y: number
  w: number
  h: number
  d: number
  /** The horizontal box (line of text) it sits in, as an index into the records. */
  parent: number
}
interface Sync {
  mtime: number
  recs: Rec[]
}

const gunzip = promisify(zlib.gunzip)
const cache = new Map<string, Sync>()

async function load(projectId: string): Promise<Sync> {
  const file = latex.synctexPath(projectId)
  const st = await fs.stat(file).catch(() => null)
  if (!st) throw new HttpError(404, "Compile first: there is no SyncTeX data for this PDF yet.")
  const hit = cache.get(projectId)
  if (hit && hit.mtime === st.mtimeMs) return hit
  const text = (await gunzip(await fs.readFile(file))).toString("utf8")
  const sync = { mtime: st.mtimeMs, recs: parse(text, latex.folder(projectId)) }
  cache.set(projectId, sync)
  return sync
}

/** The records of a SyncTeX file, with positions turned from sp (TeX's scaled points) into PDF points. */
export function parse(text: string, root: string): Rec[] {
  const inputs = new Map<string, string | null>()
  let unit = 1
  let mag = 1000
  let xOff = 0
  let yOff = 0
  const recs: Rec[] = []
  let page = 0
  let content = false
  // Open boxes: their record index, and -1 for vertical ones (a line's parent is the nearest hbox).
  const stack: { i: number; h: boolean }[] = []
  const realRoot = path.resolve(root)
  for (const raw of text.split("\n")) {
    if (!content) {
      const m = /^([A-Za-z ]+):(.*)$/.exec(raw)
      if (!m) continue
      const [, key, val] = m
      if (key === "Input") {
        const i = val.indexOf(":")
        const tag = val.slice(0, i)
        const p = val.slice(i + 1)
        const abs = path.resolve(realRoot, p)
        const rel = path.relative(realRoot, abs)
        // Only the student's own files; class and package files are left out.
        inputs.set(tag, rel.startsWith("..") || path.isAbsolute(rel) ? null : rel.split(path.sep).join("/"))
      } else if (key === "Unit") unit = Number(val) || 1
      else if (key === "Magnification") mag = Number(val) || 1000
      else if (key === "X Offset") xOff = Number(val) || 0
      else if (key === "Y Offset") yOff = Number(val) || 0
      else if (key === "Content") content = true
      continue
    }
    const c = raw[0]
    if (c === "{") {
      page = Number(raw.slice(1))
      stack.length = 0
      continue
    }
    if (c === ")" || c === "]") {
      stack.pop()
      continue
    }
    // Files opened later in the run are listed where they open.
    if (raw.startsWith("Input:")) {
      const val = raw.slice(6)
      const i = val.indexOf(":")
      const abs = path.resolve(realRoot, val.slice(i + 1))
      const rel = path.relative(realRoot, abs)
      inputs.set(val.slice(0, i), rel.startsWith("..") || path.isAbsolute(rel) ? null : rel.split(path.sep).join("/"))
      continue
    }
    if (!"[(hvxkg$".includes(c) || !page) continue
    // e.g. "(1,46:4736286,4736286:0,0,0" or "x1,46:4214583,2053767"
    const m = /^.(\d+),(\d+)(?:,\d+)?:(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/.exec(raw)
    if (!m) continue
    const k = (unit * mag) / 1000 / 65536 * (72 / 72.27)
    const top = [...stack].reverse().find((b) => b.h)
    const parent = top ? top.i : -1
    if (c === "(" || c === "[") stack.push({ i: recs.length, h: c === "(" })
    recs.push({
      kind: c,
      page,
      file: inputs.get(m[1]) ?? null,
      line: Number(m[2]),
      x: (Number(m[3]) + xOff) * k,
      y: (Number(m[4]) + yOff) * k,
      w: m[5] ? Number(m[5]) * k : 0,
      h: m[6] ? Number(m[6]) * k : 0,
      d: m[7] ? Number(m[7]) * k : 0,
      parent,
    })
  }
  return recs
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Source to PDF: where a line of a file ended up. Lines that made no output use the nearest one above. */
export async function view(projectId: string, file: string, line: number): Promise<{ page: number; boxes: Box[] } | null> {
  const { recs } = await load(projectId)
  const mine = recs.filter((r) => r.file === file)
  if (!mine.length) return null
  const lines = [...new Set(mine.map((r) => r.line))].sort((a, b) => a - b)
  // The line itself, else the closest line above with output, else the first below.
  const target = lines.includes(line) ? line : ([...lines].reverse().find((l) => l < line) ?? lines.find((l) => l > line)!)
  const hits = mine.filter((r) => r.line === target)
  const page = Math.min(...hits.map((r) => r.page))
  const onPage = hits.filter((r) => r.page === page)
  // The lines of text the line's words sit in (a paragraph's lines belong to its last source line,
  // so go through the words), or the line's own boxes.
  const seen = new Set<number>()
  for (const r of onPage) {
    const i = recs.indexOf(r)
    if (r.kind === "(" && r.w > 0) seen.add(i)
    else if (r.parent >= 0 && recs[r.parent].w > 0) seen.add(r.parent)
  }
  let boxes: Box[] = [...seen].map((i) => recs[i]).map((r) => ({ x: r.x, y: r.y - r.h, w: r.w, h: Math.max(r.h + r.d, 6) }))
  if (!boxes.length) {
    const xs = onPage.map((r) => r.x)
    const ys = onPage.map((r) => r.y)
    boxes = [{ x: Math.min(...xs), y: Math.min(...ys) - 10, w: Math.max(20, Math.max(...xs) - Math.min(...xs)), h: Math.max(...ys) - Math.min(...ys) + 12 }]
  }
  // A box inside another one adds nothing.
  boxes = boxes.filter((b, i) => !boxes.some((o, j) => j !== i && o.x <= b.x && o.y <= b.y && o.x + o.w >= b.x + b.w && o.y + o.h >= b.y + b.h && (o.w * o.h > b.w * b.h || j < i)))
  return { page, boxes }
}

/** PDF to source: the line of the student's file nearest to a point on a page. */
export async function edit(projectId: string, page: number, x: number, y: number): Promise<{ file: string; line: number } | null> {
  const { recs } = await load(projectId)
  const onPage = recs.filter((r) => r.page === page && r.file)
  if (!onPage.length) return null
  // The lines of text on the page; the smallest one under the point, else the nearest.
  const lines = recs.map((r, i) => ({ r, i })).filter(({ r }) => r.page === page && r.kind === "(" && r.w > 0)
  const gap = (r: Rec) => {
    const dx = Math.max(0, r.x - x, x - (r.x + r.w))
    const dy = Math.max(0, r.y - r.h - y, y - (r.y + r.d))
    return dy * 4 + dx
  }
  const area = (r: Rec) => r.w * (r.h + r.d)
  // A click between two lines still counts as on the closer one, so allow a little room.
  const near = lines.filter(({ r }) => x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - r.h - 5 && y <= r.y + r.d + 5).sort((a, b) => area(a.r) - area(b.r) || gap(a.r) - gap(b.r))
  const box = near[0] ?? lines.sort((a, b) => gap(a.r) - gap(b.r))[0]
  let best: Rec | null = null
  if (box) {
    // Inside it, the last word at or before the point (each knows its own source line).
    const words = recs.filter((r) => r.parent === box.i && r.file && "xkg$".includes(r.kind))
    best = words.filter((r) => r.x <= x + 0.5).sort((a, b) => b.x - a.x)[0] ?? words.sort((a, b) => a.x - b.x)[0] ?? (box.r.file ? box.r : null)
  }
  if (!best) best = onPage.sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y))[0] ?? null
  return best ? { file: best.file!, line: best.line } : null
}
