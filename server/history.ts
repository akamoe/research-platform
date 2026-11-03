import fs from "node:fs/promises"
import path from "node:path"
import { HttpError, safeJoin } from "./paths.ts"
import { projectDir } from "./projects.ts"

/**
 * Note history: copies of a note kept in `<project>/.history/notes/<note path>/<time>.md`.
 * Saving keeps a copy at most every 10 minutes; restoring keeps one of the current text first.
 */
const EVERY_MS = 10 * 60 * 1000
const KEEP = 60

const dirOf = (id: string, rel: string) => safeJoin(path.join(projectDir(id), ".history", "notes"), rel)
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-")
const timeOf = (file: string) => file.replace(/\.md$/, "").replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, "T$1:$2:$3.$4Z")

async function files(id: string, rel: string) {
  const names = await fs.readdir(dirOf(id, rel)).catch(() => [] as string[])
  return names.filter((n) => n.endsWith(".md")).sort()
}

/** Keep a copy of `content`, unless a recent copy exists (or the last copy says the same). */
export async function snapshot(id: string, rel: string, content: string, force = false) {
  const dir = dirOf(id, rel)
  const list = await files(id, rel)
  const last = list.at(-1)
  if (last) {
    const same = (await fs.readFile(path.join(dir, last), "utf8").catch(() => null)) === content
    if (same) return
    if (!force && Date.now() - Date.parse(timeOf(last)) < EVERY_MS) return
  }
  if (!content.trim()) return
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, `${stamp()}.md`), content)
  for (const old of list.slice(0, Math.max(0, list.length + 1 - KEEP))) await fs.rm(path.join(dir, old)).catch(() => {})
}

export async function list(id: string, rel: string) {
  const dir = dirOf(id, rel)
  const out = []
  for (const f of (await files(id, rel)).reverse()) {
    const text = await fs.readFile(path.join(dir, f), "utf8").catch(() => "")
    out.push({ id: f.replace(/\.md$/, ""), at: timeOf(f), words: text.split(/\s+/).filter(Boolean).length })
  }
  return out
}

export async function read(id: string, rel: string, version: string) {
  if (!/^[\w-]+$/.test(version)) throw new HttpError(400, "Invalid version")
  const text = await fs.readFile(path.join(dirOf(id, rel), `${version}.md`), "utf8").catch(() => null)
  if (text === null) throw new HttpError(404, "Version not found")
  return text
}

/** A renamed note keeps its history. */
export async function move(id: string, from: string, to: string) {
  const src = dirOf(id, from)
  if (!(await fs.stat(src).catch(() => null))) return
  const dest = dirOf(id, to)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.rename(src, dest).catch(() => {})
}
