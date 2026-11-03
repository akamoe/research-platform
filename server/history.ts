import fs from "node:fs/promises"
import path from "node:path"
import { HttpError, safeJoin } from "./paths.ts"
import { projectDir } from "./projects.ts"

/**
 * Version history: copies of a note kept in `<project>/.history/notes/<note path>/<time>.md`, and
 * of a LaTeX file in `<project>/.history/latex/<file>/<time>.md`.
 * Saving keeps a copy at most every 10 minutes; restoring keeps one of the current text first.
 */
export type Area = "notes" | "latex"
const EVERY_MS = 10 * 60 * 1000
const KEEP = 60

const dirOf = (id: string, rel: string, area: Area = "notes") => safeJoin(path.join(projectDir(id), ".history", area), rel)
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-")
const timeOf = (file: string) => file.replace(/\.md$/, "").replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, "T$1:$2:$3.$4Z")

async function files(id: string, rel: string, area: Area = "notes") {
  const names = await fs.readdir(dirOf(id, rel, area)).catch(() => [] as string[])
  return names.filter((n) => n.endsWith(".md")).sort()
}

/** Keep a copy of `content`, unless a recent copy exists (or the last copy says the same). */
export async function snapshot(id: string, rel: string, content: string, force = false, area: Area = "notes") {
  const dir = dirOf(id, rel, area)
  const list = await files(id, rel, area)
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

export async function list(id: string, rel: string, area: Area = "notes") {
  const dir = dirOf(id, rel, area)
  const out = []
  for (const f of (await files(id, rel, area)).reverse()) {
    const text = await fs.readFile(path.join(dir, f), "utf8").catch(() => "")
    out.push({ id: f.replace(/\.md$/, ""), at: timeOf(f), words: text.split(/\s+/).filter(Boolean).length })
  }
  return out
}

export async function read(id: string, rel: string, version: string, area: Area = "notes") {
  if (!/^[\w-]+$/.test(version)) throw new HttpError(400, "Invalid version")
  const text = await fs.readFile(path.join(dirOf(id, rel, area), `${version}.md`), "utf8").catch(() => null)
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
