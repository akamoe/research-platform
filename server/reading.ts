import fs from "node:fs/promises"
import path from "node:path"
import { HttpError, writeFileAtomic } from "./paths.ts"
import { getProject, projectDir } from "./projects.ts"
import * as sources from "./sources.ts"

/**
 * The reading list: sources the student means to read, is reading, or has read, in their own order,
 * with how far they got in each PDF and a rough reading time. Stored in `<project>/reading.json`.
 */

export type Status = "to-read" | "reading" | "read"
export interface Entry {
  status: Status
  addedAt: string
  startedAt?: string
  finishedAt?: string
}
export interface Progress {
  page: number
  /** The furthest page reached. */
  maxPage: number
  pages: number
  at: string
}
interface Store {
  /** Ids in the student's order (all statuses). */
  order: string[]
  items: Record<string, Entry>
  progress: Record<string, Progress>
}

const file = (projectId: string) => path.join(projectDir(projectId), "reading.json")
async function read(projectId: string): Promise<Store> {
  await getProject(projectId)
  try {
    const raw = JSON.parse(await fs.readFile(file(projectId), "utf8"))
    return { order: raw.order ?? [], items: raw.items ?? {}, progress: raw.progress ?? {} }
  } catch {
    return { order: [], items: {}, progress: {} }
  }
}
const write = (projectId: string, s: Store) => writeFileAtomic(file(projectId), JSON.stringify(s, null, 2))

const queues = new Map<string, Promise<unknown>>()
function locked<T>(projectId: string, fn: () => Promise<T>) {
  const next = (queues.get(projectId) ?? Promise.resolve()).then(fn, fn)
  queues.set(projectId, next.catch(() => {}))
  return next
}

/** About how long a source takes to read, in minutes, at an unhurried academic pace. */
const WPM = 200
const minutesCache = new Map<string, { len: number; minutes: number }>()
async function minutes(projectId: string, sourceId: string) {
  const text = await sources.sourceText(projectId, sourceId)
  const key = `${projectId}/${sourceId}`
  const hit = minutesCache.get(key)
  if (hit && hit.len === text.length) return hit.minutes
  const words = text.replace(/\[page \d+\]/g, " ").split(/\s+/).filter(Boolean).length
  const m = Math.max(1, Math.round(words / WPM))
  minutesCache.set(key, { len: text.length, minutes: m })
  return m
}

export async function state(projectId: string) {
  const s = await read(projectId)
  const all = await sources.listSources(projectId)
  const ids = new Set(all.map((x) => x.id))
  // Sources that were removed drop out of the list.
  const order = s.order.filter((id) => ids.has(id) && s.items[id])
  const estimates: Record<string, number> = {}
  for (const id of order) estimates[id] = await minutes(projectId, id)
  return { order, items: s.items, progress: s.progress, minutes: estimates }
}

export function setStatus(projectId: string, sourceId: string, status: Status | null) {
  return locked(projectId, async () => {
    await sources.getSource(projectId, sourceId)
    const s = await read(projectId)
    const now = new Date().toISOString()
    if (!status) {
      delete s.items[sourceId]
      s.order = s.order.filter((x) => x !== sourceId)
    } else {
      const e = s.items[sourceId] ?? { status, addedAt: now }
      e.status = status
      if (status === "reading") e.startedAt ??= now
      if (status === "read") e.finishedAt = now
      else delete e.finishedAt
      s.items[sourceId] = e
      if (!s.order.includes(sourceId)) s.order.push(sourceId)
    }
    await write(projectId, s)
    return state(projectId)
  })
}

export function reorder(projectId: string, order: string[]) {
  return locked(projectId, async () => {
    const s = await read(projectId)
    const known = order.filter((id) => s.items[id])
    s.order = [...known, ...s.order.filter((id) => !known.includes(id))]
    await write(projectId, s)
    return state(projectId)
  })
}

/** The PDF viewer reports the page the student is on. */
export function progress(projectId: string, sourceId: string, page: number, pages: number) {
  return locked(projectId, async () => {
    if (!/^[\w-]+$/.test(sourceId)) throw new HttpError(400, "Invalid source")
    const s = await read(projectId)
    const prev = s.progress[sourceId]
    s.progress[sourceId] = { page, maxPage: Math.max(page, prev?.maxPage ?? 0), pages, at: new Date().toISOString() }
    // Opening a paper on the list moves it to "reading"; past page one is the start.
    const e = s.items[sourceId]
    if (e?.status === "to-read" && page > 1) {
      e.status = "reading"
      e.startedAt = new Date().toISOString()
    }
    await write(projectId, s)
    return s.progress[sourceId]
  })
}

/** For the PDF viewer: where to open a paper again. */
export async function lastPage(projectId: string, sourceId: string) {
  return (await read(projectId)).progress[sourceId]?.page ?? null
}
