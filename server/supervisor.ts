import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import JSZip from "jszip"
import { DOMParser } from "linkedom"
import { getDocumentProxy } from "unpdf"
import { z } from "zod"
import { HttpError, writeFileAtomic } from "./paths.ts"
import { getProject, moveToTrash, projectDir } from "./projects.ts"

/**
 * Supervisor feedback: the comments (and tracked changes) in a draft the supervisor sent back as
 * Word or PDF become a checklist the student works through. Each comment can be marked addressed
 * or "won't change", with the student's own reply. Files live in `<project>/supervisor/`.
 */

const Item = z.object({
  id: z.string(),
  type: z.enum(["comment", "insert", "delete", "replace", "markup"]),
  author: z.string().optional(),
  date: z.string().optional(),
  page: z.number().int().optional(),
  /** The words the comment is attached to. */
  anchor: z.string().optional(),
  text: z.string(),
  status: z.enum(["open", "done", "declined"]).default("open"),
  /** The student's reply: what they changed, or why not. */
  reply: z.string().max(4000).optional(),
  resolvedAt: z.string().optional(),
})
export type Item = z.infer<typeof Item>

const Review = z.object({
  id: z.string(),
  title: z.string(),
  fileName: z.string(),
  kind: z.enum(["docx", "pdf"]),
  importedAt: z.string(),
  items: z.array(Item),
})
export type Review = z.infer<typeof Review>

const dir = (projectId: string) => path.join(projectDir(projectId), "supervisor")
const file = (projectId: string) => path.join(dir(projectId), "reviews.json")

export async function list(projectId: string): Promise<Review[]> {
  await getProject(projectId)
  const raw = await fs.readFile(file(projectId), "utf8").catch(() => "[]")
  try {
    return z.array(Review).parse(JSON.parse(raw))
  } catch {
    return []
  }
}
const save = async (projectId: string, reviews: Review[]) => {
  await fs.mkdir(dir(projectId), { recursive: true })
  await writeFileAtomic(file(projectId), JSON.stringify(reviews, null, 2) + "\n")
}

// ---------- Word ----------

const squash = (s: string) => s.replace(/\s+/g, " ").trim()

/* eslint-disable @typescript-eslint/no-explicit-any */
async function fromDocx(bytes: Uint8Array): Promise<Omit<Item, "id" | "status">[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(bytes)
  } catch {
    throw new HttpError(400, "That file isn't a Word document (.docx).")
  }
  const xml = async (name: string) => {
    const f = zip.file(name)
    return f ? new DOMParser().parseFromString(await f.async("string"), "text/xml") as any : null
  }
  const doc = await xml("word/document.xml")
  if (!doc) throw new HttpError(400, "That file isn't a Word document (.docx).")
  const comments = await xml("word/comments.xml")

  // Walk the document once, in order: collect the words each comment is attached to, and the
  // tracked insertions and deletions, grouped per paragraph.
  const anchors = new Map<string, string>()
  const open = new Set<string>()
  const changes: Omit<Item, "id" | "status">[] = []
  const walk = (el: any, ctx: { ins?: any; del?: any }) => {
    for (const child of Array.from(el.childNodes ?? []) as any[]) {
      if (child.nodeType !== 1) continue
      const tag: string = child.tagName
      if (tag === "w:commentRangeStart") open.add(child.getAttribute("w:id"))
      else if (tag === "w:commentRangeEnd") open.delete(child.getAttribute("w:id"))
      else if (tag === "w:t" || tag === "w:delText") {
        const t = child.textContent ?? ""
        for (const id of open) anchors.set(id, (anchors.get(id) ?? "") + t)
        if (ctx.ins) ctx.ins.text += t
        if (ctx.del) ctx.del.text += t
      } else if (tag === "w:ins" || tag === "w:del") {
        const rec = { text: "", author: child.getAttribute("w:author") ?? undefined, date: child.getAttribute("w:date") ?? undefined }
        walk(child, tag === "w:ins" ? { ins: rec } : { del: rec })
        pending.push({ kind: tag === "w:ins" ? "insert" : "delete", ...rec })
        continue
      } else if (tag === "w:p") {
        for (const id of open) anchors.set(id, (anchors.get(id) ?? "") + " ")
        pending = []
        walk(child, ctx)
        flush(child)
        continue
      }
      walk(child, ctx)
    }
  }
  let pending: { kind: "insert" | "delete"; text: string; author?: string; date?: string }[] = []
  const flush = (p: any) => {
    if (!pending.length) return
    const context = squash(
      Array.from(p.getElementsByTagName("w:t") as ArrayLike<any>)
        .map((t: any) => t.textContent)
        .join(""),
    )
    // A deletion right before an insertion by the same person reads as a replacement.
    for (let i = 0; i < pending.length; i++) {
      const c = pending[i]
      const next = pending[i + 1]
      if (c.kind === "delete" && next?.kind === "insert" && next.author === c.author) {
        changes.push({ type: "replace", author: c.author, date: c.date, anchor: context.slice(0, 160), text: `Replace “${squash(c.text)}” with “${squash(next.text)}”` })
        i++
      } else if (squash(c.text))
        changes.push({
          type: c.kind,
          author: c.author,
          date: c.date,
          anchor: context.slice(0, 160),
          text: `${c.kind === "insert" ? "Add" : "Delete"} “${squash(c.text)}”`,
        })
    }
    pending = []
  }
  walk(doc.documentElement, {})

  const out: Omit<Item, "id" | "status">[] = []
  for (const c of Array.from(comments?.getElementsByTagName("w:comment") ?? []) as any[]) {
    const id = c.getAttribute("w:id")
    const text = Array.from(c.getElementsByTagName("w:p") as ArrayLike<any>)
      .map((p: any) =>
        Array.from(p.getElementsByTagName("w:t") as ArrayLike<any>)
          .map((t: any) => t.textContent)
          .join(""),
      )
      .filter((t) => t.trim())
      .join("\n")
    if (!text.trim()) continue
    out.push({
      type: "comment",
      author: c.getAttribute("w:author") ?? undefined,
      date: c.getAttribute("w:date") ?? undefined,
      anchor: squash(anchors.get(id) ?? "") || undefined,
      text: text.trim(),
    })
  }
  return [...out, ...changes]
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------- PDF ----------

const MARKUP = new Set(["Highlight", "Underline", "StrikeOut", "Squiggly"])
const SKIP = new Set(["Link", "Popup", "Widget"])

async function fromPdf(bytes: Uint8Array): Promise<Omit<Item, "id" | "status">[]> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes))
  } catch {
    throw new HttpError(400, "That file isn't a readable PDF.")
  }
  const out: Omit<Item, "id" | "status">[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const anns = (await page.getAnnotations()) as any[]
    if (!anns.some((a) => !SKIP.has(a.subtype))) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = ((await page.getTextContent()).items as any[]).filter((i) => typeof i.str === "string" && i.str.trim())
    // Text items are often whole lines, so take the part of each line inside the marked box,
    // assuming evenly wide characters, then widen to whole words.
    const under = (rects: number[][]) => {
      const parts: string[] = []
      for (const i of items) {
        const x = i.transform[4]
        const y = i.transform[5] + (i.height || 8) / 2
        const w = i.width || 1
        const str: string = i.str
        for (const [x1, y1, x2, y2] of rects) {
          if (y < y1 - 1 || y > y2 + 1 || x + w < x1 || x > x2) continue
          let a = Math.max(0, Math.floor(((x1 - x) / w) * str.length))
          let b = Math.min(str.length, Math.ceil(((x2 - x) / w) * str.length))
          while (a > 0 && /\S/.test(str[a - 1])) a--
          while (b < str.length && /\S/.test(str[b])) b++
          parts.push(str.slice(a, b))
        }
      }
      return squash(parts.join(" ")).replace(/[,;:]$/, "")
    }
    for (const a of anns) {
      if (SKIP.has(a.subtype) || a.inReplyTo) continue
      const text: string = squash(a.contentsObj?.str ?? a.contents ?? "")
      const author: string | undefined = a.titleObj?.str || a.title || undefined
      // Quads come as one flat list of x,y pairs (4 corners per quad); fall back to the rect.
      let rects: number[][] = [a.rect]
      const q = a.quadPoints
      if (q && q.length >= 8) {
        rects = []
        const flat: number[] = Array.from(q.length && typeof q[0] === "object" ? (q as { x: number; y: number }[][]).flat().flatMap((p) => [p.x, p.y]) : (q as number[]))
        for (let i = 0; i + 7 < flat.length; i += 8) {
          const xs = [flat[i], flat[i + 2], flat[i + 4], flat[i + 6]]
          const ys = [flat[i + 1], flat[i + 3], flat[i + 5], flat[i + 7]]
          rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)])
        }
      }
      const anchor = MARKUP.has(a.subtype) ? under(rects) : undefined
      if (!text && !anchor) continue
      const what = a.subtype === "StrikeOut" ? "Delete" : a.subtype === "Highlight" ? "" : a.subtype === "Underline" ? "Underlined" : ""
      out.push({
        type: MARKUP.has(a.subtype) && !text ? "markup" : "comment",
        author,
        date: pdfDate(a.modificationDate ?? a.creationDate),
        page: n,
        anchor: anchor || undefined,
        text: text || `${what || a.subtype}${anchor ? ` “${anchor}”` : ""}`,
      })
    }
  }
  return out
}

/** "D:20261101100000Z" or "D:20261101100000+01'00'" -> ISO. */
function pdfDate(d?: string) {
  const m = d?.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/)
  if (!m) return undefined
  return `${m[1]}-${m[2] ?? "01"}-${m[3] ?? "01"}T${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}Z`
}

// ---------- reviews ----------

export async function importFile(projectId: string, fileName: string, bytes: Uint8Array) {
  const ext = fileName.split(".").pop()?.toLowerCase()
  if (ext !== "docx" && ext !== "pdf") throw new HttpError(415, "Import a Word (.docx) or PDF file with comments.")
  const raw = ext === "docx" ? await fromDocx(bytes) : await fromPdf(bytes)
  if (!raw.length) throw new HttpError(422, "No comments or tracked changes were found in that file.")
  const id = crypto.randomUUID().slice(0, 8)
  await fs.mkdir(dir(projectId), { recursive: true })
  await fs.writeFile(path.join(dir(projectId), `${id}.${ext}`), bytes)
  const review: Review = {
    id,
    title: fileName.replace(/\.(docx|pdf)$/i, ""),
    fileName,
    kind: ext,
    importedAt: new Date().toISOString(),
    items: raw.map((r, i) => ({ ...r, id: `${id}-${i + 1}`, status: "open" })),
  }
  const all = await list(projectId)
  await save(projectId, [review, ...all])
  return review
}

const Patch = z.object({ status: z.enum(["open", "done", "declined"]).optional(), reply: z.string().max(4000).optional() })

export async function updateItem(projectId: string, reviewId: string, itemId: string, value: unknown) {
  const patch = Patch.parse(value)
  const all = await list(projectId)
  const item = all.find((r) => r.id === reviewId)?.items.find((i) => i.id === itemId)
  if (!item) throw new HttpError(404, "Comment not found")
  if (patch.status) {
    item.status = patch.status
    item.resolvedAt = patch.status === "open" ? undefined : new Date().toISOString()
  }
  if (patch.reply !== undefined) item.reply = patch.reply || undefined
  await save(projectId, all)
  return item
}

export async function rename(projectId: string, reviewId: string, title: string) {
  const all = await list(projectId)
  const r = all.find((x) => x.id === reviewId)
  if (!r) throw new HttpError(404, "Not found")
  r.title = title.trim().slice(0, 200) || r.title
  await save(projectId, all)
  return r
}

/** Into the trash, with its file. */
export async function remove(projectId: string, reviewId: string) {
  const all = await list(projectId)
  const r = all.find((x) => x.id === reviewId)
  if (!r) throw new HttpError(404, "Not found")
  const f = path.join(dir(projectId), `${r.id}.${r.kind}`)
  await fs.writeFile(path.join(dir(projectId), `${r.id}.json`), JSON.stringify(r, null, 2))
  await moveToTrash(path.join(dir(projectId), `${r.id}.json`), `${projectId}-supervisor-${r.id}`).catch(() => {})
  await moveToTrash(f, `${projectId}-supervisor-${r.id}-file`).catch(() => {})
  await save(projectId, all.filter((x) => x.id !== reviewId))
}

export function originalPath(projectId: string, review: Review) {
  return path.join(dir(projectId), `${review.id}.${review.kind}`)
}

/** Open comments, for the mentor. */
export async function brief(projectId: string) {
  const open = (await list(projectId).catch(() => [])).flatMap((r) => r.items.filter((i) => i.status === "open" && i.type === "comment"))
  if (!open.length) return null
  return open
    .slice(0, 30)
    .map((i) => `- ${i.author ? `${i.author}: ` : ""}${i.text}${i.anchor ? ` (on “${i.anchor.slice(0, 80)}”)` : ""}`)
    .join("\n")
}
