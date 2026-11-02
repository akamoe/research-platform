import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { HttpError, PROJECTS_DIR, TRASH_DIR, safeJoin } from "./paths.ts"

export interface Project {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}

/** Sub-folders every project gets. Notes are the student's own writing. */
const FOLDERS = ["notes", "knowledge", "sources", "chats"] as const

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .slice(0, 40) || "project"
  )
}

function projectDir(id: string) {
  if (!/^[\w-]+$/.test(id)) throw new HttpError(400, "Invalid project id")
  return safeJoin(PROJECTS_DIR, id)
}

async function exists(p: string) {
  return fs.stat(p).then(() => true, () => false)
}

export async function listProjects(): Promise<Project[]> {
  await fs.mkdir(PROJECTS_DIR, { recursive: true })
  const entries = await fs.readdir(PROJECTS_DIR, { withFileTypes: true })
  const projects: Project[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue
    try {
      projects.push(await getProject(e.name))
    } catch {}
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getProject(id: string): Promise<Project> {
  const file = path.join(projectDir(id), "project.json")
  if (!(await exists(file))) throw new HttpError(404, "Project not found")
  return { id, ...JSON.parse(await fs.readFile(file, "utf8")) }
}

async function saveProject(p: Project) {
  const { id, ...rest } = p
  await fs.writeFile(path.join(projectDir(id), "project.json"), JSON.stringify(rest, null, 2))
}

export async function touchProject(id: string) {
  const p = await getProject(id)
  p.updatedAt = new Date().toISOString()
  await saveProject(p)
}

export async function createProject(name: string, description = ""): Promise<Project> {
  name = name.trim()
  if (!name) throw new HttpError(400, "Name is required")
  let id = slugify(name)
  if (await exists(path.join(PROJECTS_DIR, id))) id = `${id}-${crypto.randomBytes(2).toString("hex")}`
  const dir = projectDir(id)
  for (const f of FOLDERS) await fs.mkdir(path.join(dir, f), { recursive: true })
  const now = new Date().toISOString()
  const project: Project = { id, name, description: description.trim(), createdAt: now, updatedAt: now }
  await saveProject(project)
  await fs.writeFile(
    path.join(dir, "notes", "Start here.md"),
    `# ${name}\n\n${description.trim() ? description.trim() + "\n\n" : ""}Write your research question here, in your own words.\n`,
  )
  return project
}

export async function updateProject(id: string, patch: { name?: string; description?: string }) {
  const p = await getProject(id)
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new HttpError(400, "Name is required")
    p.name = patch.name.trim()
  }
  if (patch.description !== undefined) p.description = patch.description.trim()
  p.updatedAt = new Date().toISOString()
  await saveProject(p)
  return p
}

/** Never hard-delete: move to the trash folder so nothing is lost by a misclick. */
async function moveToTrash(full: string, label: string) {
  await fs.mkdir(TRASH_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  await fs.rename(full, path.join(TRASH_DIR, `${stamp}-${label}`))
}

export async function deleteProject(id: string) {
  await getProject(id)
  await moveToTrash(projectDir(id), id)
}

// ---------- notes (.md files) ----------

export interface NoteFile {
  path: string
  name: string
  updatedAt: string
  size: number
}

function notesDir(id: string) {
  return path.join(projectDir(id), "notes")
}

function notePath(id: string, rel: string) {
  if (!rel.toLowerCase().endsWith(".md")) throw new HttpError(400, "Only .md files are supported")
  return safeJoin(notesDir(id), rel)
}

export async function listNotes(id: string): Promise<NoteFile[]> {
  await getProject(id)
  const root = notesDir(id)
  await fs.mkdir(root, { recursive: true })
  const out: NoteFile[] = []
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.name.toLowerCase().endsWith(".md")) {
        const st = await fs.stat(full)
        const rel = path.relative(root, full).split(path.sep).join("/")
        out.push({ path: rel, name: e.name.replace(/\.md$/i, ""), updatedAt: st.mtime.toISOString(), size: st.size })
      }
    }
  }
  await walk(root)
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

export async function readNote(id: string, rel: string) {
  const full = notePath(id, rel)
  if (!(await exists(full))) throw new HttpError(404, "Note not found")
  return fs.readFile(full, "utf8")
}

export async function writeNote(id: string, rel: string, content: string) {
  const full = notePath(id, rel)
  await fs.mkdir(path.dirname(full), { recursive: true })
  await fs.writeFile(full, content)
  await touchProject(id)
}

export async function createNote(id: string, name: string, content = "") {
  await getProject(id)
  const base = name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "") || "Untitled"
  let rel = `${base}.md`
  for (let i = 2; await exists(notePath(id, rel)); i++) rel = `${base} ${i}.md`
  await writeNote(id, rel, content || `# ${base}\n\n`)
  return rel
}

export async function renameNote(id: string, from: string, toName: string) {
  const src = notePath(id, from)
  if (!(await exists(src))) throw new HttpError(404, "Note not found")
  const base = toName.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\.md$/i, "")
  if (!base) throw new HttpError(400, "Name is required")
  const dir = path.posix.dirname(from)
  const rel = (dir === "." ? "" : dir + "/") + base + ".md"
  const dest = notePath(id, rel)
  if (dest !== src && (await exists(dest))) throw new HttpError(409, "A note with that name already exists")
  await fs.rename(src, dest)
  return rel
}

export async function deleteNote(id: string, rel: string) {
  const full = notePath(id, rel)
  if (!(await exists(full))) throw new HttpError(404, "Note not found")
  await moveToTrash(full, `${id}-${path.basename(full)}`)
}

// ---------- chats ----------

export interface StoredChat {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model?: { provider: string; model: string }
  messages: { role: "user" | "assistant"; content: string }[]
}

function chatFile(id: string, chatId: string) {
  if (!/^[\w-]+$/.test(chatId)) throw new HttpError(400, "Invalid chat id")
  return path.join(projectDir(id), "chats", `${chatId}.json`)
}

export async function listChats(id: string) {
  await getProject(id)
  const dir = path.join(projectDir(id), "chats")
  await fs.mkdir(dir, { recursive: true })
  const chats: Omit<StoredChat, "messages">[] = []
  for (const f of await fs.readdir(dir)) {
    if (!f.endsWith(".json")) continue
    try {
      const { messages: _m, ...meta } = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as StoredChat
      chats.push(meta)
    } catch {}
  }
  return chats.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function readChat(id: string, chatId: string): Promise<StoredChat> {
  const f = chatFile(id, chatId)
  if (!(await exists(f))) throw new HttpError(404, "Chat not found")
  return JSON.parse(await fs.readFile(f, "utf8"))
}

export async function saveChat(id: string, chat: StoredChat) {
  await fs.mkdir(path.join(projectDir(id), "chats"), { recursive: true })
  await fs.writeFile(chatFile(id, chat.id), JSON.stringify(chat, null, 2))
}

export async function deleteChat(id: string, chatId: string) {
  const f = chatFile(id, chatId)
  if (await exists(f)) await moveToTrash(f, `${id}-chat-${chatId}.json`)
}
