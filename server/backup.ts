import fs from "node:fs/promises"
import { createReadStream, createWriteStream } from "node:fs"
import os from "node:os"
import path from "node:path"
import crypto from "node:crypto"
import { pipeline } from "node:stream/promises"
import JSZip from "jszip"
import { DATA_DIR, HttpError, PROJECTS_DIR, safeJoin } from "./paths.ts"
import { getProject, listProjects, moveToTrash, projectDir, updateProject } from "./projects.ts"
import { readSettings, writeSettings } from "./settings.ts"

/**
 * Backups: each project zipped into a folder the student picks (a Dropbox, iCloud Drive, OneDrive or
 * Google Drive folder keeps a copy off the computer, and lets another computer restore it). Folio
 * backs up changed projects every day or week, keeps the newest few per project, and restores a
 * backup as a copy or in place of the project (which then goes to the trash). API keys and
 * settings are never in a backup.
 */

export type Every = "off" | "daily" | "weekly"
export interface BackupSettings {
  dir?: string
  every?: Every
  keep?: number
}
export interface Backup {
  /** Path inside the backup folder: `<project id>/<file>.zip`. */
  file: string
  projectId: string
  name: string
  at: string
  bytes: number
}

const MANIFEST = "folio-backup.json"
const EVERY_MS: Record<Exclude<Every, "off">, number> = { daily: 24 * 3600_000, weekly: 7 * 24 * 3600_000 }
// Files that are already compressed: zipping them again only costs time.
const STORED = /\.(pdf|png|jpe?g|gif|webp|zip|docx|pptx|xlsx|odt|mp3|mp4|woff2?)$/i
const SKIP = (rel: string) => rel.startsWith("latex/.build/") || /(^|\/)\.DS_Store$/.test(rel)

export function defaultDir() {
  return path.join(DATA_DIR, "backups")
}
export async function config(): Promise<Required<BackupSettings>> {
  const b = (await readSettings()).backup ?? {}
  return { dir: b.dir || defaultDir(), every: b.every ?? "daily", keep: b.keep ?? 10 }
}
export async function configure(patch: BackupSettings) {
  const s = await readSettings()
  const next = { ...s.backup, ...patch }
  if (next.dir !== undefined) {
    next.dir = next.dir.trim().replace(/^~(?=$|[\\/])/, os.homedir())
    if (next.dir && !path.isAbsolute(next.dir)) throw new HttpError(400, "Give the folder's full path, like /Users/you/Dropbox/Folio")
    if (next.dir) {
      await fs.mkdir(next.dir, { recursive: true }).catch(() => {
        throw new HttpError(400, "Folio can't create or write to that folder")
      })
      if (path.resolve(next.dir).startsWith(path.resolve(PROJECTS_DIR))) throw new HttpError(400, "Pick a folder outside your projects")
    }
  }
  s.backup = next
  await writeSettings(s)
  return status()
}

async function walk(root: string, rel = ""): Promise<{ rel: string; full: string; mtime: number }[]> {
  const out: { rel: string; full: string; mtime: number }[] = []
  for (const e of await fs.readdir(path.join(root, rel), { withFileTypes: true }).catch(() => [])) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (SKIP(r) || e.isSymbolicLink()) continue
    if (e.isDirectory()) out.push(...(await walk(root, r)))
    else if (e.isFile()) out.push({ rel: r, full: path.join(root, r), mtime: (await fs.stat(path.join(root, r))).mtimeMs })
  }
  return out
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}

/** Zip a project into a stream: for downloading, or for the backup folder. */
async function zipProject(id: string) {
  const project = await getProject(id)
  const zip = new JSZip()
  zip.file(MANIFEST, JSON.stringify({ app: "Folio", version: 1, project, createdAt: new Date().toISOString() }, null, 2))
  for (const f of await walk(projectDir(id))) {
    zip.file(`project/${f.rel}`, createReadStream(f.full), { compression: STORED.test(f.rel) ? "STORE" : "DEFLATE", date: new Date(f.mtime) })
  }
  return { project, stream: zip.generateNodeStream({ type: "nodebuffer", streamFiles: true, compression: "DEFLATE" }) }
}

export async function download(id: string) {
  const { project, stream } = await zipProject(id)
  return { stream, fileName: `${project.name.replace(/[\\/:*?"<>|]+/g, "-")} ${stamp().slice(0, 10)}.zip` }
}

let running: Promise<unknown> | null = null
let lastError: string | null = null

/** Write one project's backup into the folder and keep only the newest few. */
async function backupOne(id: string, dir: string, keep: number) {
  const folder = path.join(dir, id)
  await fs.mkdir(folder, { recursive: true })
  const base = `${id} ${stamp()}`
  const tmp = path.join(folder, `.${base}.zip.partial`)
  const { project, stream } = await zipProject(id)
  await pipeline(stream, createWriteStream(tmp))
  await fs.rename(tmp, path.join(folder, `${base}.zip`))
  const bytes = (await fs.stat(path.join(folder, `${base}.zip`))).size
  // A small note next to each zip, so the list doesn't have to open the zips.
  await fs.writeFile(path.join(folder, `${base}.json`), JSON.stringify({ projectId: id, name: project.name, at: new Date().toISOString(), bytes }))
  const zips = (await fs.readdir(folder)).filter((f) => f.endsWith(".zip") && f.startsWith(`${id} `)).sort()
  // Only Folio's own backup files are removed, oldest first.
  for (const old of zips.slice(0, Math.max(0, zips.length - keep))) {
    await fs.rm(path.join(folder, old), { force: true })
    await fs.rm(path.join(folder, old.replace(/\.zip$/, ".json")), { force: true })
  }
}

export async function list(): Promise<Backup[]> {
  const { dir } = await config()
  const out: Backup[] = []
  for (const sub of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!sub.isDirectory() || !/^[\w-]+$/.test(sub.name)) continue
    for (const f of await fs.readdir(path.join(dir, sub.name)).catch(() => [] as string[])) {
      if (!f.endsWith(".json")) continue
      const zip = f.replace(/\.json$/, ".zip")
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, sub.name, f), "utf8"))
        await fs.access(path.join(dir, sub.name, zip))
        out.push({ file: `${sub.name}/${zip}`, projectId: sub.name, name: meta.name ?? sub.name, at: meta.at, bytes: meta.bytes ?? 0 })
      } catch {}
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/** Back up the projects that changed since their last backup (all of them with `force`). */
export async function run(force = false) {
  if (running) return running
  running = (async () => {
    const { dir, keep } = await config()
    const backups = await list()
    for (const p of await listProjects()) {
      const last = backups.find((b) => b.projectId === p.id)
      if (!force && last) {
        const changed = (await walk(projectDir(p.id))).some((f) => f.mtime > Date.parse(last.at))
        if (!changed) continue
      }
      await backupOne(p.id, dir, keep)
    }
    lastError = null
  })()
    .catch((err) => {
      lastError = (err as Error).message
      throw err
    })
    .finally(() => {
      running = null
    })
  return running
}

export async function status() {
  const c = await config()
  const backups = await list()
  return { ...c, defaultDir: defaultDir(), running: !!running, error: lastError, last: backups[0]?.at ?? null, backups }
}

/** Every half hour: back up if a day (or week) has passed since the newest backup. */
export function schedule() {
  const tick = async () => {
    const { every } = await config()
    if (every === "off") return
    const newest = (await list())[0]
    if (newest && Date.now() - Date.parse(newest.at) < EVERY_MS[every]) return
    await run().catch((err) => console.warn("Backup failed:", (err as Error).message))
  }
  setTimeout(() => void tick(), 60_000)
  setInterval(() => void tick(), 30 * 60_000).unref()
}

/**
 * Restore a backup zip. `copy` adds it as a new project; `replace` puts the current project with the
 * same id in the trash first.
 */
export async function restore(data: Buffer | Uint8Array, mode: "copy" | "replace" = "copy") {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(data)
  } catch {
    throw new HttpError(400, "That isn't a Folio backup (.zip)")
  }
  const manifest = await zip.file(MANIFEST)?.async("string")
  if (!manifest) throw new HttpError(400, "That zip isn't a Folio backup")
  const meta = JSON.parse(manifest) as { project?: { id?: string; name?: string } }
  const srcId = /^[\w-]+$/.test(meta.project?.id ?? "") ? meta.project!.id! : "restored"
  const exists = await getProject(srcId).then(() => true, () => false)
  let id = srcId
  if (exists && mode === "copy") id = `${srcId}-${crypto.randomBytes(2).toString("hex")}`
  const target = projectDir(id)
  // Unpack beside the projects first, so a broken zip leaves nothing half-restored.
  const tmp = path.join(PROJECTS_DIR, `.restoring-${crypto.randomBytes(4).toString("hex")}`)
  try {
    for (const entry of Object.values(zip.files)) {
      if (entry.dir || !entry.name.startsWith("project/")) continue
      const rel = entry.name.slice("project/".length)
      if (!rel) continue
      const out = safeJoin(tmp, rel)
      await fs.mkdir(path.dirname(out), { recursive: true })
      await pipeline(entry.nodeStream("nodebuffer") as NodeJS.ReadableStream, createWriteStream(out))
    }
    await fs.access(path.join(tmp, "project.json")).catch(() => {
      throw new HttpError(400, "The backup has no project in it")
    })
    if (exists && mode === "replace") await moveToTrash(target, `${id}-before-restore`)
    await fs.rename(tmp, target)
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    throw err
  }
  if (exists && mode === "copy") {
    const when = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    await updateProject(id, { name: `${meta.project?.name ?? id} (restored ${when})` })
  }
  return getProject(id)
}

export async function restoreFromFolder(file: string, mode: "copy" | "replace") {
  const { dir } = await config()
  if (!/^[\w-]+\/[^\\/]+\.zip$/.test(file)) throw new HttpError(400, "Unknown backup")
  return restore(await fs.readFile(safeJoin(dir, file)), mode)
}
