import fs from "node:fs/promises"
import { createWriteStream, constants as FS } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { DATA_DIR, HttpError, safeJoin, writeFileAtomic } from "./paths.ts"
import { getProject, moveToTrash, projectDir, touchProject } from "./projects.ts"

/**
 * The project's LaTeX paper: plain files in `<project>/latex/`, compiled on this computer with
 * the TeX the student already has (latexmk, from MacTeX, TeX Live or MiKTeX) or with Tectonic,
 * a single small program Folio can download for them. Output goes to `latex/.build/`.
 */

export const MAIN = "main.tex"
const BUILD = ".build"
const TEXT_EXT = new Set(["tex", "bib", "sty", "cls", "bst", "bbx", "cbx", "txt", "md"])
const UPLOAD_EXT = new Set([...TEXT_EXT, "png", "jpg", "jpeg", "pdf", "eps"])
/** Kept in step with the project's References on every compile, so \cite keys always resolve. */
export const LIBRARY_BIB = "references.bib"

const dir = (projectId: string) => path.join(projectDir(projectId), "latex")
const ext = (p: string) => p.split(".").pop()?.toLowerCase() ?? ""

/** A path the student may touch: inside latex/, no hidden parts (so never .build), a known type. */
function filePath(projectId: string, rel: string, allowed = UPLOAD_EXT) {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "")
  if (!clean || clean.split("/").some((s) => !s || s.startsWith("."))) throw new HttpError(400, "Invalid file name")
  if (!allowed.has(ext(clean))) throw new HttpError(400, `Folio can't use .${ext(clean)} files here`)
  return safeJoin(dir(projectId), clean)
}

export interface LatexFile {
  path: string
  size: number
  text: boolean
  /** references.bib is rewritten from References, so edits there would be lost. */
  library?: boolean
}

function template(title: string) {
  const esc = title.replace(/([&%$#_{}])/g, "\\$1").replace(/~/g, "\\textasciitilde{}").replace(/\^/g, "\\textasciicircum{}")
  return `\\documentclass[12pt]{article}
\\usepackage[margin=1in]{geometry}
\\usepackage{graphicx}
\\usepackage[authoryear,round]{natbib}
\\usepackage[hidelinks]{hyperref}

\\title{${esc}}
\\author{Your name}
\\date{\\today}

\\begin{document}
\\maketitle

\\section{Introduction}


% Cite with \\citep{key} or \\citet{key}: type \\cite and pick from your References.
% After your first citation, remove the % from the next two lines to print the reference list.
% \\bibliographystyle{apalike}
% \\bibliography{references}

\\end{document}
`
}

async function ensure(projectId: string) {
  const project = await getProject(projectId)
  const root = dir(projectId)
  await fs.mkdir(root, { recursive: true })
  const main = path.join(root, MAIN)
  if (!(await fs.stat(main).catch(() => null))) await fs.writeFile(main, template(project.name), { flag: "wx" }).catch(() => {})
  return root
}

export async function listFiles(projectId: string): Promise<LatexFile[]> {
  const root = await ensure(projectId)
  const out: LatexFile[] = []
  const walk = async (rel: string, depth: number) => {
    const entries = await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.startsWith(".")) continue
      const p = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (depth < 3) await walk(p, depth + 1)
      } else if (UPLOAD_EXT.has(ext(p))) {
        const st = await fs.stat(path.join(root, p))
        out.push({ path: p, size: st.size, text: TEXT_EXT.has(ext(p)), ...(p === LIBRARY_BIB ? { library: true } : {}) })
      }
    }
  }
  await walk("", 0)
  // main.tex first, then other .tex files, then everything else.
  const rank = (f: LatexFile) => (f.path === MAIN ? 0 : ext(f.path) === "tex" ? 1 : f.text ? 2 : 3)
  return out.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
}

export async function readFile(projectId: string, rel: string) {
  await ensure(projectId)
  const full = filePath(projectId, rel, TEXT_EXT)
  try {
    return await fs.readFile(full, "utf8")
  } catch {
    throw new HttpError(404, "File not found")
  }
}

export async function writeFile(projectId: string, rel: string, content: string, opts: { create?: boolean } = {}) {
  await ensure(projectId)
  if (rel === LIBRARY_BIB) throw new HttpError(400, "references.bib comes from your References. Edit them there.")
  const full = filePath(projectId, rel, TEXT_EXT)
  await fs.mkdir(path.dirname(full), { recursive: true })
  if (opts.create) {
    if (await fs.stat(full).catch(() => null)) throw new HttpError(409, `${rel} already exists`)
    await fs.writeFile(full, content)
  } else {
    await writeFileAtomic(full, content)
  }
  void touchProject(projectId)
}

export async function upload(projectId: string, rel: string, bytes: Uint8Array) {
  await ensure(projectId)
  if (rel === LIBRARY_BIB) throw new HttpError(400, "references.bib comes from your References")
  const full = filePath(projectId, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, bytes)
}

export async function deleteFile(projectId: string, rel: string) {
  if (rel === MAIN) throw new HttpError(400, "main.tex is the document itself and can't be removed")
  const full = filePath(projectId, rel)
  if (!(await fs.stat(full).catch(() => null))) throw new HttpError(404, "File not found")
  await moveToTrash(full, `${projectId}-latex-${path.basename(full)}`)
}

export async function binaryFile(projectId: string, rel: string) {
  return fs.readFile(filePath(projectId, rel))
}

export function pdfPath(projectId: string) {
  return path.join(dir(projectId), BUILD, MAIN.replace(/\.tex$/, ".pdf"))
}

// ---------- the TeX engine ----------

const TECTONIC_VERSION = "0.17.0"
const TOOLS_DIR = path.join(DATA_DIR, ".tools")
const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name)
const ownTectonic = () => path.join(TOOLS_DIR, `tectonic-${TECTONIC_VERSION}`, exe("tectonic"))

function tectonicAsset() {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : null
  if (!arch) return null
  const target =
    process.platform === "darwin"
      ? `${arch}-apple-darwin.tar.gz`
      : process.platform === "linux"
        ? `${arch}-unknown-linux-musl.tar.gz`
        : process.platform === "win32" && arch === "x86_64"
          ? "x86_64-pc-windows-msvc.zip"
          : null
  if (!target) return null
  const name = `tectonic-${TECTONIC_VERSION}-${target}`
  return { name, url: `https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/${name}` }
}

/** Where TeX usually lives, even when the terminal that started Folio didn't put it on PATH. */
function searchDirs() {
  const extra =
    process.platform === "win32"
      ? []
      : ["/Library/TeX/texbin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.join(os.homedir(), "bin"), path.join(os.homedir(), ".cargo/bin")]
  // TinyTeX keeps its binaries in a per-platform folder under the home directory.
  const tiny = path.join(os.homedir(), process.platform === "darwin" ? "Library/TinyTeX/bin/universal-darwin" : ".TinyTeX/bin/x86_64-linux")
  return [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), ...extra, tiny]
}

async function which(name: string) {
  for (const d of searchDirs()) {
    const p = path.join(d, exe(name))
    try {
      await fs.access(p, FS.X_OK)
      return p
    } catch {}
  }
  return null
}

export interface Engine {
  kind: "latexmk" | "tectonic"
  path: string
  /** Folio downloaded it. */
  bundled?: boolean
}

export async function findEngine(): Promise<Engine | null> {
  const forced = process.env.RP_LATEX_ENGINE
  if (forced) return { kind: path.basename(forced).startsWith("latexmk") ? "latexmk" : "tectonic", path: forced }
  const latexmk = await which("latexmk")
  if (latexmk && (await which("pdflatex"))) return { kind: "latexmk", path: latexmk }
  const own = ownTectonic()
  if (await fs.access(own, FS.X_OK).then(() => true, () => false)) return { kind: "tectonic", path: own, bundled: true }
  const tectonic = await which("tectonic")
  if (tectonic) return { kind: "tectonic", path: tectonic }
  return null
}

let install: { done: number; total: number; error: string | null; running: boolean } | null = null

export async function engineStatus() {
  const engine = await findEngine()
  return {
    engine,
    installable: !!tectonicAsset(),
    install: install && (install.running || install.error) ? install : null,
  }
}

/** Downloads Tectonic (about 20 MB) into the data folder. It fetches the LaTeX packages a document needs on first use. */
export function installTectonic() {
  const asset = tectonicAsset()
  if (!asset) throw new HttpError(400, "There is no Tectonic download for this computer. Install TeX Live or MiKTeX instead.")
  if (install?.running) return
  install = { done: 0, total: 0, error: null, running: true }
  const state = install
  void (async () => {
    const target = path.dirname(ownTectonic())
    const tmp = path.join(TOOLS_DIR, `.${asset.name}.${process.pid}`)
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
      await run("tar", [asset.name.endsWith(".zip") ? "-xf" : "-xzf", tmp, "-C", target], target, 120_000)
      await fs.chmod(ownTectonic(), 0o755)
    } catch (err) {
      state.error = (err as Error).message
    } finally {
      state.running = false
      await fs.rm(tmp, { force: true })
    }
  })()
}

// ---------- compiling ----------

export interface Problem {
  severity: "error" | "warning"
  file: string | null
  line: number | null
  message: string
}

export interface CompileResult {
  ok: boolean
  pdf: boolean
  /** This run wrote a new PDF (a failed run can leave the last good one in place). */
  fresh: boolean
  problems: Problem[]
  log: string
  ms: number
  engine: Engine["kind"]
}

function run(cmd: string, args: string[], cwd: string, timeout: number) {
  return new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, PATH: searchDirs().join(path.delimiter) } })
    let output = ""
    const take = (d: Buffer) => {
      output += d.toString()
      if (output.length > 400_000) output = output.slice(-300_000)
    }
    child.stdout.on("data", take)
    child.stderr.on("data", take)
    let timedOut = false
    const t = setTimeout(() => {
      timedOut = true
      child.kill("SIGKILL")
    }, timeout)
    child.on("error", (e) => {
      clearTimeout(t)
      reject(e)
    })
    child.on("close", (code) => {
      clearTimeout(t)
      resolve({ code, output, timedOut })
    })
  })
}

/** XeLaTeX for documents that need system fonts or right-to-left scripts (Arabic, Persian, Hebrew). */
function latexmkProgram(source: string) {
  const magic = /^%\s*!TEX\s+(?:TS-)?program\s*=\s*(\w+)/im.exec(source)?.[1]?.toLowerCase()
  if (magic === "xelatex" || magic === "lualatex" || magic === "pdflatex") return magic
  return /\\usepackage(?:\[[^\]]*\])?\{[^}]*\b(fontspec|polyglossia|bidi|xeCJK|arabxetex|unicode-math)\b/.test(source) ? "xelatex" : "pdflatex"
}

/** Errors and warnings in TeX output, with the file and line when TeX says where. */
export function parseProblems(output: string): Problem[] {
  const problems: Problem[] = []
  const seen = new Set<string>()
  const add = (p: Problem) => {
    const k = `${p.severity}|${p.file}|${p.line}|${p.message}`
    if (seen.has(k) || problems.length > 60) return
    seen.add(k)
    problems.push(p)
  }
  const lines = output.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    // Tectonic: "error: main.tex:12: Undefined control sequence"; file-line-error: "./main.tex:12: ..."
    let m = /^(?:(error|warning): )?(?:\.\/)?([^\s:][^:]*\.(?:tex|sty|cls|bib|bbl|aux)):(\d+): (.+)$/.exec(l)
    if (m) {
      const severity = m[1] === "warning" ? "warning" : "error"
      // TeX puts the offending text on the next line ("l.12 \foo"); keep the message alone.
      add({ severity, file: m[2].replace(/^\.\//, ""), line: Number(m[3]), message: m[4].replace(/\.$/, "") })
      continue
    }
    m = /^! (.+)$/.exec(l)
    if (m) {
      const at = lines.slice(i + 1, i + 8).map((x) => /^l\.(\d+)/.exec(x)).find(Boolean)
      add({ severity: "error", file: null, line: at ? Number(at[1]) : null, message: m[1].replace(/\.$/, "") })
      continue
    }
    m = /^(?:LaTeX|Package (\w+)) Warning: (.+?)(?: on input line (\d+))?\.?$/.exec(l)
    if (m) {
      add({ severity: "warning", file: null, line: m[3] ? Number(m[3]) : null, message: m[2] })
      continue
    }
    m = /^error: (.+)$/.exec(l)
    if (m && !/halted on potentially-recoverable error/.test(m[1])) add({ severity: "error", file: null, line: null, message: m[1] })
  }
  return problems
}

async function compileNow(projectId: string): Promise<CompileResult> {
  const root = await ensure(projectId)
  const engine = await findEngine()
  if (!engine) throw new HttpError(412, "LaTeX isn't installed yet")
  const started = Date.now()

  // The library's .bib, always current.
  const bib = await fs.readFile(path.join(projectDir(projectId), LIBRARY_BIB), "utf8").catch(() => "")
  await fs.writeFile(path.join(root, LIBRARY_BIB), bib)
  await fs.mkdir(path.join(root, BUILD), { recursive: true })
  const pdf = pdfPath(projectId)
  const before = await fs.stat(pdf).then((s) => s.mtimeMs, () => 0)

  const source = await fs.readFile(path.join(root, MAIN), "utf8").catch(() => "")
  const args =
    engine.kind === "tectonic"
      ? ["--outdir", BUILD, "--synctex", "--keep-logs", "--keep-intermediates", "--chatter", "minimal", MAIN]
      : [`-${latexmkProgram(source) === "pdflatex" ? "pdf" : latexmkProgram(source)}`, "-interaction=nonstopmode", "-file-line-error", "-synctex=1", `-outdir=${BUILD}`, MAIN]
  // Tectonic downloads packages the first time it sees them, so give it longer.
  const { code, output, timedOut } = await run(engine.path, args, root, engine.kind === "tectonic" ? 300_000 : 180_000).catch(
    (err: Error) => {
      throw new HttpError(500, `Couldn't run ${engine.kind}: ${err.message}`)
    },
  )
  const after = await fs.stat(pdf).then((s) => s.mtimeMs, () => 0)
  let problems = parseProblems(output)
  // TeX's own log has the details when the engine's summary doesn't.
  if (code !== 0 && !problems.some((p) => p.severity === "error")) {
    const logFile = path.join(root, BUILD, MAIN.replace(/\.tex$/, ".log"))
    const fresh = await fs.stat(logFile).then((st) => st.mtimeMs >= started - 1000, () => false)
    const log = fresh ? await fs.readFile(logFile, "utf8").catch(() => "") : ""
    if (log) problems = [...parseProblems(log).filter((p) => p.severity === "error"), ...problems]
  }
  if (timedOut) problems.unshift({ severity: "error", file: null, line: null, message: "Compiling took too long and was stopped" })
  if (code !== 0 && !problems.some((p) => p.severity === "error")) {
    // Tectonic fetches packages as it goes; without internet the first compile fails here.
    const offline = engine.kind === "tectonic" && /(network|dns|resolve|connect|timed? ?out|relay|bundle|https?:\/\/)/i.test(output)
    const last = output.trim().split(/\r?\n/).filter((l) => l.trim()).pop()?.trim().slice(0, 240)
    problems.unshift({
      severity: "error",
      file: null,
      line: null,
      message: offline
        ? "Tectonic couldn't download the LaTeX packages it needs. Check your internet connection and compile again."
        : `${engine.kind} stopped${last ? `: ${last}` : ` (exit code ${code})`}`,
    })
  }
  return {
    ok: code === 0 && !timedOut,
    pdf: after > 0,
    fresh: after > before,
    problems,
    log: output.slice(-60_000),
    ms: Date.now() - started,
    engine: engine.kind,
  }
}

/** One compile per project at a time; requests made meanwhile share the next run. */
const busy = new Map<string, Promise<CompileResult>>()
const queued = new Map<string, Promise<CompileResult>>()
export function compile(projectId: string): Promise<CompileResult> {
  const waiting = queued.get(projectId)
  if (waiting) return waiting
  const start = () => {
    queued.delete(projectId)
    const p = compileNow(projectId).finally(() => {
      if (busy.get(projectId) === p) busy.delete(projectId)
    })
    busy.set(projectId, p)
    return p
  }
  const current = busy.get(projectId)
  if (!current) return start()
  const next = current.catch(() => {}).then(start)
  queued.set(projectId, next)
  return next
}
