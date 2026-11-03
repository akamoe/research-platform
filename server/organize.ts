import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { writeFileAtomic } from "./paths.ts"
import { getProject, projectDir } from "./projects.ts"

/**
 * How the student arranges the sidebar: starred items and folders. It lives in
 * `<project>/organize.json` and never moves a file, so notes, sources and their links stay put.
 * Items are keyed "s:<sourceId>" or "n:<note path>".
 */
export const Organize = z.object({
  starred: z.array(z.string().max(600)).max(2000).default([]),
  folders: z
    .array(
      z.object({
        id: z.string().regex(/^[\w-]{1,40}$/),
        name: z.string().trim().min(1).max(120),
        section: z.enum(["sources", "notes"]),
        parent: z.string().max(40).optional(),
      }),
    )
    .max(500)
    .default([]),
  /** Item key -> folder id. Items not listed sit at the top of their section. */
  placed: z.record(z.string().max(600), z.string().max(40)).default({}),
})
export type Organize = z.infer<typeof Organize>

const file = (projectId: string) => path.join(projectDir(projectId), "organize.json")

export async function read(projectId: string): Promise<Organize> {
  await getProject(projectId)
  const raw = await fs.readFile(file(projectId), "utf8").catch(() => "{}")
  try {
    return Organize.parse(JSON.parse(raw))
  } catch {
    return Organize.parse({})
  }
}

export async function write(projectId: string, value: unknown): Promise<Organize> {
  await getProject(projectId)
  const data = Organize.parse(value)
  // Drop placements in folders that no longer exist, and parents that point nowhere.
  const ids = new Set(data.folders.map((f) => f.id))
  for (const [k, v] of Object.entries(data.placed)) if (!ids.has(v)) delete data.placed[k]
  for (const f of data.folders) if (f.parent && (!ids.has(f.parent) || f.parent === f.id)) delete f.parent
  await writeFileAtomic(file(projectId), JSON.stringify(data, null, 2) + "\n")
  return data
}

/** Keep stars and folders when a note is renamed. */
export async function renameKey(projectId: string, from: string, to: string) {
  const data = await read(projectId)
  if (!data.starred.includes(from) && !(from in data.placed)) return
  data.starred = data.starred.map((k) => (k === from ? to : k))
  if (from in data.placed) {
    data.placed[to] = data.placed[from]
    delete data.placed[from]
  }
  await write(projectId, data)
}
