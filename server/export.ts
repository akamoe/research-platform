import fs from "node:fs/promises"
import { createWriteStream, constants as FS } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { HttpError } from "./paths.ts"
import { getProject, projectDir, readNote } from "./projects.ts"
import * as references from "./references.ts"
import * as sources from "./sources.ts"
import * as latex from "./latex.ts"

/**
 * Turning notes into Word, PDF or other documents with real citations and a reference list, using
 * pandoc. Pandoc is used from the computer when installed; otherwise Folio downloads it once
 * into `<data>/.tools/` (like Tectonic). PDFs go through the LaTeX engine from the LaTeX tab.
 */

const PANDOC_VERSION = "3.6.4"
const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name)
const ownDir = () => path.join(latex.TOOLS_DIR, `pandoc-${PANDOC_VERSION}`)

function pandocAsset() {
  const a = process.arch
  const name =
    process.platform === "darwin" && (a === "arm64" || a === "x64")
      ? `pandoc-${PANDOC_VERSION}-${a === "arm64" ? "arm64" : "x86_64"}-macOS.zip`
      : process.platform === "linux" && (a === "arm64" || a === "x64")
        ? `pandoc-${PANDOC_VERSION}-linux-${a === "arm64" ? "arm64" : "amd64"}.tar.gz`
        : process.platform === "win32" && a === "x64"
          ? `pandoc-${PANDOC_VERSION}-windows-x86_64.zip`
          : null
  return name ? { name, url: `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/${name}` } : null
}

/** The pandoc binary inside the unpacked download (its folder name differs per platform). */
async function ownPandoc() {
  const root = ownDir()
  for (const sub of await fs.readdir(root).catch(() => [] as string[])) {
    for (const p of [path.join(root, sub, "bin", exe("pandoc")), path.join(root, sub, exe("pandoc"))]) {
      if (await fs.access(p, FS.X_OK).then(() => true, () => false)) return p
    }
  }
  return null
}

export async function findPandoc(): Promise<{ path: string; bundled?: boolean } | null> {
  if (process.env.RP_PANDOC) return { path: process.env.RP_PANDOC }
  const own = await ownPandoc()
  if (own) return { path: own, bundled: true }
  const sys = await latex.which("pandoc")
  return sys ? { path: sys } : null
}

let install: { done: number; total: number; error: string | null; running: boolean } | null = null

export async function status() {
  const [pandoc, engine] = await Promise.all([findPandoc(), latex.findEngine()])
  return {
    pandoc,
    installable: !!pandocAsset(),
    install: install && (install.running || install.error) ? install : null,
    pdf: !!engine,
  }
}

/** Downloads pandoc (about 35 MB) into the data folder. */
export function installPandoc() {
  const asset = pandocAsset()
  if (!asset) throw new HttpError(400, "There is no pandoc download for this computer. Install pandoc from pandoc.org instead.")
  if (install?.running) return
  install = { done: 0, total: 0, error: null, running: true }
  const state = install
  void (async () => {
    const target = ownDir()
    const tmp = path.join(latex.TOOLS_DIR, `.${asset.name}.${process.pid}`)
    try {
      await fs.mkdir(target, { recursive: true })
      const res = await fetch(asset.url, { redirect: "follow" })
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      state.total = Number(res.headers.get("content-length") ?? 0)
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, ctl) {
          state.done += chunk.byteLength
          ctl.enqueue(chunk)
        },
      })
      await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(tmp))
      // bsdtar (macOS, Windows) unpacks zips too.
      const r = await run("tar", [asset.name.endsWith(".zip") ? "-xf" : "-xzf", tmp, "-C", target], target, 180_000)
      if (r.code !== 0) throw new Error(`Couldn't unpack pandoc: ${r.output.slice(-300)}`)
      const bin = await ownPandoc()
      if (!bin) throw new Error("pandoc wasn't found in the download")
      await fs.chmod(bin, 0o755)
    } catch (err) {
      state.error = (err as Error).message
    } finally {
      state.running = false
      await fs.rm(tmp, { force: true })
    }
  })()
}

function run(cmd: string, args: string[], cwd: string, timeout: number) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, PATH: latex.searchDirs().join(path.delimiter) } })
    let output = ""
    const take = (d: Buffer) => {
      output += d.toString()
      if (output.length > 200_000) output = output.slice(-100_000)
    }
    child.stdout.on("data", take)
    child.stderr.on("data", take)
    const t = setTimeout(() => child.kill("SIGKILL"), timeout)
    child.on("error", (e) => {
      clearTimeout(t)
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(t)
      resolve({ code, output })
    })
  })
}

// ---------- building the document ----------

export type Format = "docx" | "pdf" | "odt" | "html" | "latex"
const EXT: Record<Format, string> = { docx: "docx", pdf: "pdf", odt: "odt", html: "html", latex: "tex" }

const PAGE_BREAK: Partial<Record<Format, string>> = {
  docx: '\n\n```{=openxml}\n<w:p><w:r><w:br w:type="page"/></w:r></w:p>\n```\n\n',
  odt: '\n\n```{=opendocument}\n<text:p text:style-name="Pagebreak"/>\n```\n\n',
  pdf: "\n\n\\newpage\n\n",
  latex: "\n\n\\newpage\n\n",
}

/** A note as plain pandoc markdown: images point at files, and Folio's own links become text. */
async function prepare(projectId: string, md: string) {
  const assetRe = /\/api\/projects\/[\w-]+\/sources\/([\w-]+)\/assets\/([\w.-]+)/g
  return (
    md
      // Figures captured from PDFs: the image file on disk. Their "hl/…" title is Folio's link back.
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"hl\/[^"]*")?\)/g, (m, alt: string, url: string) => {
        const a = [...url.matchAll(assetRe)][0]
        if (!a) return m
        return `![${alt}](<${path.join(sources.assetsDir(projectId, a[1]), a[2])}>)`
      })
      // Figures made from the student's data: their picture on disk.
      .replace(/(!\[[^\]]*\]\()\/api\/projects\/[\w-]+\/figures\/([\w-]+)\.png(?:\?[^)\s]*)?\)/g, (_, head: string, fid: string) =>
        `${head}<${path.join(projectDir(projectId), "figures", `${fid}.png`)}>)`,
      )
      // Reading-note links back to a highlight or a passage: drop them, they mean nothing outside Folio.
      .replace(/\s*\[[^\]]*\]\(#(?:hl|src)\/[^)]*\)/g, "")
      .replace(/\\\[(@[^\]]*)\\\]/g, "[$1]")
  )
}

const isArabic = (t: string) => (t.match(/[؀-ۿ]/g)?.length ?? 0) > 0.3 * (t.match(/\p{L}/gu)?.length ?? 1)

export interface ExportOptions {
  notes: string[]
  format: Format
  style: string
  /** For a thesis: the title page and a table of contents. */
  title?: string
  author?: string
  toc?: boolean
  name?: string
}

export async function exportNotes(projectId: string, o: ExportOptions) {
  await getProject(projectId)
  const pandoc = await findPandoc()
  if (!pandoc) throw new HttpError(409, "Exporting needs pandoc. Install it from the export window.")
  if (!o.notes.length) throw new HttpError(400, "Nothing to export")

  const parts: string[] = []
  for (const n of o.notes) parts.push(await prepare(projectId, await readNote(projectId, n)))
  const body = parts.join(PAGE_BREAK[o.format] ?? "\n\n")

  const work = await fs.mkdtemp(path.join(os.tmpdir(), "folio-export-"))
  try {
    await fs.writeFile(path.join(work, "doc.md"), body)
    const refs = (await references.list(projectId)).map(({ source: _s, addedAt: _a, ...r }) => r)
    await fs.writeFile(path.join(work, "references.json"), JSON.stringify(refs))

    const args = ["doc.md", "--from", "markdown", "--citeproc", "--bibliography", "references.json", "--metadata", "link-citations=true", "--standalone"]
    const csl = await references.styleFile(o.style)
    if (csl) args.push("--csl", csl)
    const arabic = isArabic(body)
    args.push("--metadata", `reference-section-title=${arabic ? "المراجع" : "References"}`)
    if (arabic) args.push("--metadata", "lang=ar", "--metadata", "dir=rtl")
    if (o.title) args.push("--metadata", `title=${o.title}`)
    if (o.author) args.push("--metadata", `author=${o.author}`)
    if (o.toc) args.push("--toc")
    if (o.format === "html") args.push("--embed-resources")

    if (o.format === "pdf") {
      const engine = await latex.findEngine()
      if (!engine) throw new HttpError(409, "PDF export uses LaTeX. Open the LaTeX tab once to set it up (one click), then try again.")
      let pdfEngine = engine.path
      if (engine.kind === "latexmk") pdfEngine = (await latex.which("xelatex")) ?? (await latex.which("lualatex")) ?? (await latex.which("pdflatex")) ?? engine.path
      args.push("--pdf-engine", pdfEngine, "-V", "geometry:margin=2.5cm")
    }
    const out = `out.${EXT[o.format]}`
    args.push("-o", out)
    const r = await run(pandoc.path, args, work, 240_000)
    if (r.code !== 0) {
      const msg = r.output.split("\n").filter((l) => /error|not found|cannot|could not/i.test(l)).slice(0, 4).join(" ") || r.output.slice(-400)
      throw new HttpError(500, `Export failed: ${msg.trim()}`)
    }
    const warnings = [...new Set([...r.output.matchAll(/Citeproc: citation (\S+) not found/g)].map((m) => m[1]))]

    const dir = path.join(projectDir(projectId), "exports")
    await fs.mkdir(dir, { recursive: true })
    const base = (o.name ?? path.basename(o.notes[0], ".md")).replace(/[\\/:*?"<>|]+/g, "-").trim() || "export"
    const file = `${base}.${EXT[o.format]}`
    await fs.copyFile(path.join(work, out), path.join(dir, file))
    return { file, missingCitations: warnings, style: csl ? o.style : null }
  } finally {
    await fs.rm(work, { recursive: true, force: true })
  }
}

export function exportPath(projectId: string, file: string) {
  if (!/^[^\\/]+\.(docx|pdf|odt|html|tex)$/.test(file)) throw new HttpError(400, "Unknown export")
  return path.join(projectDir(projectId), "exports", file)
}
