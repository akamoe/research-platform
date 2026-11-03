import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { z } from "zod"
import { HttpError, TRASH_DIR, safeJoin, writeFileAtomic } from "./paths.ts"
import { getProject, projectDir, readNote, writeNote } from "./projects.ts"
import * as latex from "./latex.ts"
import * as history from "./history.ts"

/**
 * Figures and tables the student makes from their own data. Datasets are CSV files in
 * `<project>/data/`; each figure's settings are in `<project>/figures.json` and its picture (drawn
 * in the browser) in `<project>/figures/<id>.png` and `.svg`. Figures go into a note as an image,
 * or into the LaTeX folder as `latex/figures/<name>.png` with a figure environment to paste.
 */

const dataDir = (pid: string) => path.join(projectDir(pid), "data")
const imgDir = (pid: string) => path.join(projectDir(pid), "figures")
const specFile = (pid: string) => path.join(projectDir(pid), "figures.json")

const DATA_NAME = /^[^\\/:*?"<>|]{1,120}\.(csv|tsv|txt)$/i
const cleanName = (name: string) =>
  name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.(csv|tsv|txt)$/i, "")
    .trim()
    .slice(0, 100) || "data"

export async function listDatasets(pid: string) {
  await getProject(pid)
  const out: { name: string; bytes: number; modified: string }[] = []
  for (const f of await fs.readdir(dataDir(pid)).catch(() => [] as string[])) {
    if (!DATA_NAME.test(f)) continue
    const st = await fs.stat(path.join(dataDir(pid), f))
    out.push({ name: f, bytes: st.size, modified: st.mtime.toISOString() })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function addDataset(pid: string, fileName: string, text: string) {
  await getProject(pid)
  if (text.length > 20 * 1024 * 1024) throw new HttpError(413, "That file is over 20 MB. Folio's charts are for smaller tables.")
  const ext = /\.tsv$/i.test(fileName) || (!/\.csv$/i.test(fileName) && text.split("\n", 1)[0].includes("\t")) ? "tsv" : "csv"
  const base = cleanName(fileName)
  await fs.mkdir(dataDir(pid), { recursive: true })
  let name = `${base}.${ext}`
  for (let n = 2; await fs.stat(path.join(dataDir(pid), name)).then(() => true, () => false); n++) name = `${base} ${n}.${ext}`
  await fs.writeFile(path.join(dataDir(pid), name), text)
  return name
}

export async function readDataset(pid: string, name: string) {
  if (!DATA_NAME.test(name)) throw new HttpError(400, "Unknown data file")
  const text = await fs.readFile(safeJoin(dataDir(pid), name), "utf8").catch(() => null)
  if (text === null) throw new HttpError(404, "Data file not found")
  return text
}

export async function removeDataset(pid: string, name: string) {
  if (!DATA_NAME.test(name)) throw new HttpError(400, "Unknown data file")
  await fs.mkdir(TRASH_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  await fs.rename(safeJoin(dataDir(pid), name), path.join(TRASH_DIR, `${stamp}-${pid}-data-${name}`))
}

export const Figure = z.object({
  id: z.string().regex(/^[\w-]{1,40}$/),
  title: z.string().max(300).default(""),
  caption: z.string().max(2000).default(""),
  dataset: z.string().max(200).default(""),
  kind: z.enum(["bar", "line", "scatter", "table", "summary"]).default("bar"),
  x: z.string().max(200).default(""),
  y: z.array(z.string().max(200)).max(12).default([]),
  agg: z.enum(["mean", "sum", "count", "none"]).default("mean"),
  xLabel: z.string().max(200).default(""),
  yLabel: z.string().max(200).default(""),
  /** The table's rows, as the figure shows them: for notes and LaTeX. */
  table: z.array(z.array(z.string().max(500))).max(1000).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  hasImage: z.boolean().optional(),
})
export type Figure = z.infer<typeof Figure>

export async function list(pid: string): Promise<Figure[]> {
  await getProject(pid)
  try {
    const raw = JSON.parse(await fs.readFile(specFile(pid), "utf8"))
    return Array.isArray(raw) ? raw.map((f) => Figure.parse(f)) : []
  } catch {
    return []
  }
}

const queues = new Map<string, Promise<unknown>>()
function locked<T>(pid: string, fn: () => Promise<T>) {
  const next = (queues.get(pid) ?? Promise.resolve()).then(fn, fn)
  queues.set(pid, next.catch(() => {}))
  return next
}

export function newId() {
  return crypto.randomBytes(5).toString("hex")
}

export function save(pid: string, fig: Figure) {
  return locked(pid, async () => {
    const all = await list(pid)
    const i = all.findIndex((f) => f.id === fig.id)
    const now = new Date().toISOString()
    const next = { ...fig, createdAt: all[i]?.createdAt ?? now, updatedAt: now, hasImage: all[i]?.hasImage }
    if (i >= 0) all[i] = next
    else all.push(next)
    await writeFileAtomic(specFile(pid), JSON.stringify(all, null, 2))
    return next
  })
}

export function remove(pid: string, id: string) {
  return locked(pid, async () => {
    const all = await list(pid)
    const fig = all.find((f) => f.id === id)
    if (!fig) throw new HttpError(404, "Figure not found")
    await fs.mkdir(TRASH_DIR, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    await fs.writeFile(path.join(TRASH_DIR, `${stamp}-${pid}-figure-${id}.json`), JSON.stringify(fig, null, 2))
    for (const ext of ["png", "svg"])
      await fs.rename(path.join(imgDir(pid), `${id}.${ext}`), path.join(TRASH_DIR, `${stamp}-${pid}-figure-${id}.${ext}`)).catch(() => {})
    await writeFileAtomic(specFile(pid), JSON.stringify(all.filter((f) => f.id !== id), null, 2))
  })
}

export async function saveImage(pid: string, id: string, png: Uint8Array, svg?: string) {
  if (!/^[\w-]{1,40}$/.test(id)) throw new HttpError(400, "Invalid figure")
  await fs.mkdir(imgDir(pid), { recursive: true })
  await fs.writeFile(path.join(imgDir(pid), `${id}.png`), png)
  if (svg) await fs.writeFile(path.join(imgDir(pid), `${id}.svg`), svg)
  await locked(pid, async () => {
    const all = await list(pid)
    const f = all.find((x) => x.id === id)
    if (f && !f.hasImage) {
      f.hasImage = true
      await writeFileAtomic(specFile(pid), JSON.stringify(all, null, 2))
    }
  })
}

export function imagePath(pid: string, id: string, ext: "png" | "svg") {
  if (!/^[\w-]{1,40}$/.test(id)) throw new HttpError(400, "Invalid figure")
  return path.join(imgDir(pid), `${id}.${ext}`)
}

// ---------- into a note or LaTeX ----------

const isPicture = (f: Figure) => f.kind !== "table" && f.kind !== "summary"
const slug = (f: Figure) =>
  (f.title || f.caption || `figure-${f.id}`)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .slice(0, 40) || `figure-${f.id}`

function markdownTable(rows: string[][]) {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ")
  const [head, ...body] = rows
  const right = head.map((_, c) => body.length > 0 && body.every((r) => r[c] === "" || !Number.isNaN(Number(r[c].replace(/,/g, "")))))
  return [
    `| ${head.map(esc).join(" | ")} |`,
    `| ${head.map((_, c) => (right[c] ? "---:" : "---")).join(" | ")} |`,
    ...body.map((r) => `| ${head.map((_, c) => esc(r[c] ?? "")).join(" | ")} |`),
  ].join("\n")
}

export function markdownFor(pid: string, f: Figure) {
  const caption = (f.caption || f.title).trim()
  if (isPicture(f)) {
    if (!f.hasImage) throw new HttpError(409, "The figure's picture isn't saved yet")
    return `![${caption.replace(/[[\]]/g, "")}](/api/projects/${pid}/figures/${f.id}.png?v=${Date.parse(f.updatedAt ?? "") || 0})`
  }
  if (!f.table?.length) throw new HttpError(409, "The table is empty")
  return `${markdownTable(f.table)}${caption ? `\n\nTable: ${caption}` : ""}`
}

/** Add the figure at the end of a note. */
export async function appendToNote(pid: string, f: Figure, notePath: string) {
  const before = await readNote(pid, notePath)
  await history.snapshot(pid, notePath, before, true).catch(() => {})
  const md = markdownFor(pid, f)
  await writeNote(pid, notePath, `${before.replace(/\s*$/, "")}\n\n${md}\n`)
}

const texEsc = (s: string) =>
  s
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")

/** Put the picture in the LaTeX folder (for figures) and return the environment to paste. */
export async function latexFor(pid: string, f: Figure) {
  const name = slug(f)
  const caption = texEsc((f.caption || f.title).trim())
  if (isPicture(f)) {
    const png = await fs.readFile(imagePath(pid, f.id, "png")).catch(() => null)
    if (!png) throw new HttpError(409, "The figure's picture isn't saved yet")
    await latex.upload(pid, `figures/${name}.png`, png)
    return {
      file: `figures/${name}.png`,
      snippet: `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.9\\linewidth]{figures/${name}.png}\n  \\caption{${caption}}\n  \\label{fig:${name}}\n\\end{figure}\n`,
    }
  }
  if (!f.table?.length) throw new HttpError(409, "The table is empty")
  const [head, ...body] = f.table
  const numeric = head.map((_, c) => body.length > 0 && body.every((r) => r[c] === "" || !Number.isNaN(Number(r[c]))))
  const cols = numeric.map((n) => (n ? "r" : "l")).join("")
  const row = (r: string[]) => `    ${head.map((_, c) => texEsc(r[c] ?? "")).join(" & ")} \\\\`
  return {
    snippet: `\\begin{table}[htbp]\n  \\centering\n  \\caption{${caption}}\n  \\label{tab:${name}}\n  \\begin{tabular}{${cols}}\n    \\hline\n${row(head)}\n    \\hline\n${body.map(row).join("\n")}\n    \\hline\n  \\end{tabular}\n\\end{table}\n`,
  }
}
