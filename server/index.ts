import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"
import { Hono } from "hono"
import { stream } from "hono/streaming"
import { serve } from "@hono/node-server"
import { serveStatic } from "@hono/node-server/serve-static"
import { z } from "zod"
import { DATA_DIR, HttpError } from "./paths.ts"
import * as projects from "./projects.ts"
import { isProvider, publicSettings, readSettings, writeSettings, type ProviderId } from "./settings.ts"
import { listModels, streamChat } from "./llm.ts"
import { mentorPrompt } from "./mentor.ts"
import * as sources from "./sources.ts"
import * as knowledge from "./knowledge.ts"
import * as canvas from "./canvas.ts"
import * as references from "./references.ts"
import * as search from "./search.ts"
import * as importers from "./importers.ts"
import { backgroundModel } from "./ai.ts"

const PORT = Number(process.env.RP_PORT ?? 5174)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const DIST = path.join(ROOT, "dist")

const app = new Hono()

// This server holds API keys and writes files, so only answer the local machine.
// Checking Host blocks DNS-rebinding; checking Origin blocks other websites calling us.
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/
app.use("*", async (c, next) => {
  const host = c.req.header("host") ?? ""
  const origin = c.req.header("origin")
  if (!LOCAL.test(host)) return c.text("Forbidden host", 403)
  if (origin && !LOCAL.test(origin.replace(/^https?:\/\//, ""))) return c.text("Forbidden origin", 403)
  await next()
})

app.onError((err, c) => {
  const status = err instanceof HttpError ? err.status : err instanceof z.ZodError ? 400 : 500
  if (status === 500) console.error(err)
  const message = err instanceof z.ZodError ? err.issues.map((i) => i.message).join(", ") : err.message
  return c.json({ error: message }, status as 400)
})

const api = new Hono()

// ---------- settings ----------
api.get("/settings", async (c) => c.json(publicSettings(await readSettings())))

api.put("/settings/providers/:provider", async (c) => {
  const provider = c.req.param("provider")
  if (!isProvider(provider)) throw new HttpError(404, "Unknown provider")
  const body = z.object({ apiKey: z.string().optional(), baseUrl: z.string().optional() }).parse(await c.req.json())
  const s = await readSettings()
  const cur = s.providers[provider] ?? {}
  if (body.apiKey !== undefined) cur.apiKey = body.apiKey.trim() || undefined
  if (body.baseUrl !== undefined) cur.baseUrl = body.baseUrl.trim() || undefined
  s.providers[provider] = cur
  if (!cur.apiKey && s.defaultModel?.provider === provider) s.defaultModel = undefined
  await writeSettings(s)
  return c.json(publicSettings(s))
})

api.put("/settings/default-model", async (c) => {
  const body = z.object({ provider: z.string(), model: z.string().min(1) }).parse(await c.req.json())
  if (!isProvider(body.provider)) throw new HttpError(400, "Unknown provider")
  const s = await readSettings()
  s.defaultModel = { provider: body.provider, model: body.model }
  await writeSettings(s)
  return c.json(publicSettings(s))
})

api.get("/models/:provider", async (c) => {
  const provider = c.req.param("provider")
  if (!isProvider(provider)) throw new HttpError(404, "Unknown provider")
  return c.json({ models: await listModels(await readSettings(), provider) })
})

// ---------- projects ----------
api.get("/projects", async (c) => c.json(await projects.listProjects()))
api.post("/projects", async (c) => {
  const body = z.object({ name: z.string(), description: z.string().optional() }).parse(await c.req.json())
  return c.json(await projects.createProject(body.name, body.description), 201)
})
api.get("/projects/:id", async (c) => c.json(await projects.getProject(c.req.param("id"))))
api.patch("/projects/:id", async (c) => {
  const body = z.object({ name: z.string().optional(), description: z.string().optional() }).parse(await c.req.json())
  return c.json(await projects.updateProject(c.req.param("id"), body))
})
api.delete("/projects/:id", async (c) => {
  await projects.deleteProject(c.req.param("id"))
  return c.json({ ok: true })
})

// ---------- notes ----------
const notePathParam = (c: { req: { query: (k: string) => string | undefined } }) => {
  const p = c.req.query("path")
  if (!p) throw new HttpError(400, "path is required")
  return p
}
api.get("/projects/:id/notes", async (c) => c.json(await projects.listNotes(c.req.param("id"))))
api.get("/projects/:id/note", async (c) =>
  c.json({ path: notePathParam(c), content: await projects.readNote(c.req.param("id"), notePathParam(c)) }),
)
api.put("/projects/:id/note", async (c) => {
  const body = z.object({ content: z.string() }).parse(await c.req.json())
  await projects.writeNote(c.req.param("id"), notePathParam(c), body.content)
  return c.json({ ok: true })
})
api.post("/projects/:id/notes", async (c) => {
  const body = z.object({ name: z.string(), content: z.string().optional() }).parse(await c.req.json())
  return c.json({ path: await projects.createNote(c.req.param("id"), body.name, body.content) }, 201)
})
api.patch("/projects/:id/note", async (c) => {
  const body = z.object({ name: z.string(), unique: z.boolean().optional() }).parse(await c.req.json())
  return c.json({ path: await projects.renameNote(c.req.param("id"), notePathParam(c), body.name, body.unique) })
})
api.delete("/projects/:id/note", async (c) => {
  await projects.deleteNote(c.req.param("id"), notePathParam(c))
  return c.json({ ok: true })
})

// ---------- sources: PDFs, web pages, videos, Word files, pasted text ----------
api.get("/projects/:id/sources", async (c) => c.json(await sources.listSources(c.req.param("id"))))

/** After a source is added: find its reference (PDFs and pages with a DOI) and file it into the knowledge base. */
async function afterAdd(projectId: string, src: sources.Source, doi?: string) {
  if (!src.hasText) return
  if (src.type === "pdf" || doi)
    sources
      .sourceText(projectId, src.id)
      .then((text) => (src.type === "pdf" ? references.fromPaper(projectId, src.id, text) : references.fromPaper(projectId, src.id, "", doi)))
      .catch(() => {})
  const settings = await readSettings()
  if (settings.defaultModel && settings.providers[settings.defaultModel.provider]?.apiKey) {
    knowledge.ingestPaperInBackground(projectId, src.id, src.title)
  }
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim()

api.post("/projects/:id/sources", async (c) => {
  const id = c.req.param("id")
  const len = Number(c.req.header("content-length") ?? 0)
  if (len > sources.MAX_PDF_BYTES + 1024 * 1024) throw new HttpError(413, "That file is larger than 200 MB")
  const form = await c.req.parseBody()
  const file = form.file
  if (!(file instanceof File)) throw new HttpError(400, "No file uploaded")
  const bytes = new Uint8Array(await file.arrayBuffer())
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  let src: sources.Source
  if (ext === "docx") {
    src = await sources.addTextSource(id, {
      type: "docx",
      title: baseName(file.name),
      text: await importers.importDocx(bytes),
      fileName: file.name,
      original: { bytes, ext },
    })
  } else if (["md", "markdown", "txt", "text"].includes(ext)) {
    src = await sources.addTextSource(id, {
      type: "text",
      title: baseName(file.name),
      text: new TextDecoder().decode(bytes),
      fileName: file.name,
    })
  } else if (ext === "doc") {
    throw new HttpError(415, "Old .doc files can't be read. Save it as .docx or PDF in Word first.")
  } else {
    src = await sources.addPdf(id, file.name, bytes)
  }
  await afterAdd(id, src)
  return c.json(src, 201)
})
api.post("/projects/:id/sources/link", async (c) => {
  const id = c.req.param("id")
  const { url } = z.object({ url: z.string().min(1).max(4000) }).parse(await c.req.json())
  const got = await importers.importLink(url)
  if (got.kind === "pdf") {
    const src = await sources.addPdf(id, got.fileName, got.bytes)
    await afterAdd(id, src)
    return c.json(src, 201)
  }
  const src = await sources.addTextSource(id, { type: got.type, title: got.title, text: got.text, url: got.url, author: got.author })
  await afterAdd(id, src, got.doi)
  return c.json(src, 201)
})
api.post("/projects/:id/sources/text", async (c) => {
  const id = c.req.param("id")
  const body = z.object({ title: z.string().max(300), text: z.string().min(1) }).parse(await c.req.json())
  const title = body.title.trim() || body.text.trim().split("\n")[0].replace(/^#+\s*/, "").slice(0, 80)
  const src = await sources.addTextSource(id, { type: "text", title, text: body.text })
  await afterAdd(id, src)
  return c.json(src, 201)
})
api.get("/projects/:id/sources/:sid/text", async (c) => {
  await sources.getSource(c.req.param("id"), c.req.param("sid"))
  return c.json({ text: await sources.sourceText(c.req.param("id"), c.req.param("sid")) })
})
api.get("/projects/:id/sources/:sid", async (c) =>
  c.json(await sources.getSource(c.req.param("id"), c.req.param("sid"))),
)
api.get("/projects/:id/sources/:sid/pdf", async (c) => {
  const src = await sources.getSource(c.req.param("id"), c.req.param("sid"))
  const data = await fs.promises.readFile(sources.pdfPath(c.req.param("id"), src.id))
  return c.body(data, 200, {
    "Content-Type": "application/pdf",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(src.fileName)}`,
    "Cache-Control": "private, max-age=3600",
  })
})
api.get("/projects/:id/sources/:sid/highlights", async (c) =>
  c.json(await sources.listHighlights(c.req.param("id"), c.req.param("sid"))),
)
api.post("/projects/:id/sources/:sid/highlights", async (c) => {
  const id = c.req.param("id"), sid = c.req.param("sid")
  if ((c.req.header("content-type") ?? "").startsWith("multipart/form-data")) {
    // Area highlight: an image of part of a page.
    const form = await c.req.parseBody()
    const image = form.image
    if (!(image instanceof File)) throw new HttpError(400, "No image uploaded")
    if (image.size > 20 * 1024 * 1024) throw new HttpError(413, "Image too large")
    const meta = JSON.parse(String(form.meta ?? "{}"))
    return c.json(
      await sources.addHighlight(id, sid, { ...meta, text: undefined, image: new Uint8Array(await image.arrayBuffer()) }),
      201,
    )
  }
  const body = z
    .object({ pageIndex: z.number().int(), rects: z.array(z.any()), color: z.string(), text: z.string().optional() })
    .parse(await c.req.json())
  return c.json(await sources.addHighlight(id, sid, body), 201)
})
api.patch("/projects/:id/sources/:sid/highlights/:hid", async (c) => {
  const body = z.object({ color: z.string().optional() }).parse(await c.req.json())
  return c.json(await sources.updateHighlight(c.req.param("id"), c.req.param("sid"), c.req.param("hid"), body))
})
api.delete("/projects/:id/sources/:sid/highlights/:hid", async (c) => {
  await sources.deleteHighlight(c.req.param("id"), c.req.param("sid"), c.req.param("hid"))
  return c.json({ ok: true })
})
api.get("/projects/:id/sources/:sid/assets/:file", async (c) => {
  const data = await sources.readAsset(c.req.param("id"), c.req.param("sid"), c.req.param("file"))
  return c.body(data, 200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400" })
})
api.patch("/projects/:id/sources/:sid", async (c) => {
  const body = z.object({ title: z.string().optional(), inChat: z.boolean().optional() }).parse(await c.req.json())
  return c.json(await sources.updateSource(c.req.param("id"), c.req.param("sid"), body))
})
api.delete("/projects/:id/sources/:sid", async (c) => {
  await sources.deleteSource(c.req.param("id"), c.req.param("sid"))
  return c.json({ ok: true })
})

// ---------- knowledge base (OKF bundle) ----------
const pageParam = (c: { req: { query: (k: string) => string | undefined } }) => {
  const p = c.req.query("page")
  if (!p) throw new HttpError(400, "page is required")
  return p
}
api.get("/projects/:id/knowledge", async (c) => {
  const id = c.req.param("id")
  const [pages, st, lint] = await Promise.all([knowledge.listPages(id), knowledge.status(id), knowledge.lastLint(id)])
  return c.json({ pages, status: st, lint })
})
api.get("/projects/:id/knowledge/page", async (c) => c.json(await knowledge.readPage(c.req.param("id"), pageParam(c))))
api.put("/projects/:id/knowledge/page", async (c) => {
  const body = z.object({ raw: z.string() }).parse(await c.req.json())
  return c.json(await knowledge.savePageRaw(c.req.param("id"), pageParam(c), body.raw))
})
api.post("/projects/:id/knowledge/page/review", async (c) =>
  c.json(await knowledge.markReviewed(c.req.param("id"), pageParam(c))),
)
api.get("/projects/:id/knowledge/log", async (c) => c.json({ content: await knowledge.readLog(c.req.param("id")) }))
api.post("/projects/:id/knowledge/ingest", async (c) => {
  const id = c.req.param("id")
  const body = z.object({ sourceIds: z.array(z.string().regex(/^[\w-]+$/)).optional() }).parse(await c.req.json())
  await backgroundModel()
  const st = await knowledge.status(id)
  const todo = body.sourceIds ? st.notIngested.filter((s) => body.sourceIds!.includes(s.id)) : st.notIngested
  for (const s of todo) knowledge.ingestPaperInBackground(id, s.id, s.title)
  return c.json(await knowledge.status(id))
})
/** A source's page in the knowledge base (its summary and key points), and whether it is being written. */
api.get("/projects/:id/sources/:sid/summary", async (c) => {
  const { id, sid } = c.req.param()
  const meta = await knowledge.findPaperPage(id, sid)
  const st = await knowledge.status(id)
  const job = st.notIngested.find((s) => s.id === sid)
  return c.json({
    page: meta ? await knowledge.readPage(id, meta.id) : null,
    running: !!job?.running || st.running.some((r) => r.id === sid),
    error: job?.error ?? null,
  })
})
api.post("/projects/:id/knowledge/lint", async (c) => c.json(await knowledge.lint(c.req.param("id"))))

// ---------- notes canvas ----------
api.get("/projects/:id/canvas", async (c) => {
  const id = c.req.param("id")
  const { removed: _r, ...rest } = await canvas.readCanvas(id)
  return c.json({ ...rest, thinking: canvas.isThinking(id) })
})
api.post("/projects/:id/canvas/cards", async (c) => {
  const body = z.object({ text: z.string().max(4000), x: z.number(), y: z.number(), kind: z.enum(canvas.KINDS).optional() }).parse(await c.req.json())
  return c.json(await canvas.addCard(c.req.param("id"), body), 201)
})
api.patch("/projects/:id/canvas/cards/:cardId", async (c) => {
  const body = z
    .object({ text: z.string().max(4000).optional(), x: z.number().optional(), y: z.number().optional(), kind: z.enum(canvas.KINDS).optional() })
    .parse(await c.req.json())
  return c.json(await canvas.updateCard(c.req.param("id"), c.req.param("cardId"), body))
})
api.delete("/projects/:id/canvas/cards/:cardId", async (c) => {
  await canvas.removeCard(c.req.param("id"), c.req.param("cardId"))
  return c.json({ ok: true })
})
api.post("/projects/:id/canvas/cards/:cardId/restore", async (c) =>
  c.json(await canvas.restoreCard(c.req.param("id"), c.req.param("cardId"))),
)
const ShapeSchema = z.object({
  id: z.string().regex(/^[\w-]+$/).max(40),
  type: z.enum(["rect", "ellipse", "text", "draw", "arrow"]),
  x: z.number(),
  y: z.number(),
  w: z.number().min(1).max(20000),
  h: z.number().min(1).max(20000),
  color: z.string().max(40),
  text: z.string().max(4000).optional(),
  points: z.array(z.tuple([z.number(), z.number()])).max(5000).optional(),
})
const ArrowSchema = z.object({
  id: z.string().regex(/^[\w-]+$/).max(40),
  from: z.string().max(40),
  to: z.string().max(40),
  color: z.string().max(40),
})
api.put("/projects/:id/canvas/drawing", async (c) => {
  const body = z
    .object({ shapes: z.array(ShapeSchema).max(2000), arrows: z.array(ArrowSchema).max(2000) })
    .parse(await c.req.json())
  return c.json(await canvas.saveDrawing(c.req.param("id"), body))
})
api.post("/projects/:id/canvas/think", async (c) => {
  const { removed: _r, ...rest } = await canvas.think(c.req.param("id"))
  return c.json(rest)
})

// ---------- references and citations ----------
api.get("/projects/:id/references", async (c) => c.json(await references.list(c.req.param("id"))))
api.post("/projects/:id/references", async (c) => {
  const body = z.object({ text: z.string().max(2_000_000) }).parse(await c.req.json())
  const id = c.req.param("id")
  const { items, candidates } = await references.parse(body.text)
  if (!items.length) return c.json({ added: [], existing: [], candidates: candidates ?? [] })
  return c.json(await references.addItems(id, items))
})
api.post("/projects/:id/references/items", async (c) => {
  const body = z.object({ items: z.array(z.record(z.string(), z.unknown())).max(5000) }).parse(await c.req.json())
  return c.json(await references.addItems(c.req.param("id"), body.items, { keepIds: true }))
})
api.patch("/projects/:id/references/:rid", async (c) => {
  const body = z.record(z.string(), z.unknown()).parse(await c.req.json())
  return c.json(await references.update(c.req.param("id"), c.req.param("rid"), body as Partial<references.Reference>))
})
api.delete("/projects/:id/references/:rid", async (c) => c.json(await references.remove(c.req.param("id"), c.req.param("rid"))))
api.post("/projects/:id/references/render", async (c) => {
  const body = z
    .object({
      style: z.string().max(200).default("apa"),
      format: z.enum(["bibliography", "citation", "bibtex", "ris", "csljson"]),
      output: z.enum(["html", "text"]).optional(),
      ids: z.array(z.string()).optional(),
      notePath: z.string().optional(),
      lang: z.string().max(20).optional(),
    })
    .parse(await c.req.json())
  const id = c.req.param("id")
  let ids = body.ids
  if (body.notePath) ids = references.citedKeys(await projects.readNote(id, body.notePath))
  return c.json({ text: await references.render(id, { ...body, ids }), ids })
})
api.get("/citation-styles", async (c) => c.json(await references.findStyles(c.req.query("q") ?? "")))

// ---------- search ----------
api.get("/projects/:id/search", async (c) => {
  const q = (c.req.query("q") ?? "").slice(0, 500)
  const limit = Math.min(60, Number(c.req.query("limit")) || 30)
  const hits = await search.search(c.req.param("id"), q, { limit })
  return c.json(hits.map(({ text: _t, ...h }) => h))
})
api.get("/projects/:id/sources/:sid/passage", async (c) => {
  const p = await search.passage(c.req.param("id"), c.req.param("sid"), Number(c.req.query("page")) || 0, Number(c.req.query("chunk")) || 0)
  if (!p) throw new HttpError(404, "Passage not found")
  return c.json(p)
})

// ---------- chat ----------
api.get("/projects/:id/chats", async (c) =>
  c.json(await projects.listChats(c.req.param("id"), c.req.query("source") || undefined)),
)
api.get("/projects/:id/chats/:chatId", async (c) =>
  c.json(await projects.readChat(c.req.param("id"), c.req.param("chatId"))),
)
api.delete("/projects/:id/chats/:chatId", async (c) => {
  await projects.deleteChat(c.req.param("id"), c.req.param("chatId"))
  return c.json({ ok: true })
})

const ChatBody = z.object({
  chatId: z.string().regex(/^[\w-]+$/).optional(),
  provider: z.string(),
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).min(1),
  openNotePath: z.string().optional(),
  sourceId: z.string().regex(/^[\w-]+$/).optional(),
})

/**
 * Streams the reply as plain text. If the provider fails mid-stream, the stream
 * ends with "\u0000" followed by the error message so the browser can show it.
 */
api.post("/projects/:id/chat", async (c) => {
  const id = c.req.param("id")
  const body = ChatBody.parse(await c.req.json())
  if (!isProvider(body.provider)) throw new HttpError(400, "Unknown provider")
  const provider: ProviderId = body.provider
  const project = await projects.getProject(id)
  const notes = await projects.listNotes(id)
  let openNote: { path: string; content: string } | undefined
  if (body.openNotePath) {
    try {
      openNote = { path: body.openNotePath, content: await projects.readNote(id, body.openNotePath) }
    } catch {}
  }
  let paper: { title: string; text: string; type?: string } | undefined
  if (body.sourceId) {
    const src = await sources.getSource(id, body.sourceId)
    paper = { title: src.title, text: await sources.sourceText(id, src.id), type: src.type }
  }
  const lastQuestion = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? ""
  const memory = await knowledge.contextFor(id, `${lastQuestion} ${paper?.title ?? ""}`)
  // The project chat answers from passages of every paper the student kept in chat.
  let passages: { all: sources.Source[]; hits: search.Hit[] } | undefined
  if (!paper) {
    const all = (await sources.listSources(id)).filter((s) => s.hasText)
    const included = all.filter((s) => s.inChat !== false).map((s) => s.id)
    // The last two questions, so follow-ups like "and the second study?" still find the right passages.
    const recent = body.messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content).join(" ")
    const hits = included.length ? await search.search(id, recent, { kinds: ["source"], sourceIds: included, limit: 10 }) : []
    passages = { all: all.filter((s) => included.includes(s.id)), hits }
  }
  const settings = await readSettings()
  const controller = new AbortController()
  const gen = streamChat({
    settings,
    provider,
    model: body.model,
    system: mentorPrompt({ project, noteTitles: notes.map((n) => n.path), openNote, paper, knowledge: memory, passages }),
    messages: body.messages,
    signal: controller.signal,
  })
  // Pull the first chunk before answering so setup errors (bad key, unknown model) come back as JSON.
  const first = await gen.next()

  const chatId = body.chatId ?? crypto.randomUUID()
  c.header("X-Chat-Id", chatId)
  c.header("Content-Type", "text/plain; charset=utf-8")
  c.header("Cache-Control", "no-cache")

  return stream(c, async (s) => {
    s.onAbort(() => controller.abort())
    let reply = ""
    try {
      if (!first.done && first.value) {
        reply += first.value
        await s.write(first.value)
      }
      for await (const chunk of gen) {
        reply += chunk
        await s.write(chunk)
      }
    } catch (err) {
      if (!controller.signal.aborted) await s.write(`\u0000${(err as Error).message}`)
    } finally {
      if (reply) {
        let existing: projects.StoredChat | undefined
        try {
          existing = await projects.readChat(id, chatId)
        } catch {}
        const now = new Date().toISOString()
        const firstUser = body.messages.find((m) => m.role === "user")?.content ?? "Chat"
        await projects.saveChat(id, {
          id: chatId,
          title: existing?.title ?? firstUser.replace(/\s+/g, " ").slice(0, 60),
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
          model: { provider, model: body.model },
          sourceId: body.sourceId ?? existing?.sourceId,
          messages: [...body.messages, { role: "assistant", content: reply }],
        })
      }
    }
  })
})

app.route("/api", api)

// ---------- the web app ----------
if (fs.existsSync(DIST)) {
  app.use("/*", serveStatic({ root: path.relative(process.cwd(), DIST) || "." }))
  app.get("*", (c) => c.html(fs.readFileSync(path.join(DIST, "index.html"), "utf8")))
}

serve({ fetch: app.fetch, port: PORT, hostname: "127.0.0.1" }, async (info) => {
  const url = `http://localhost:${info.port}`
  console.log(`\n  Folio running at ${url}`)
  console.log(`  Your files are in ${DATA_DIR}\n`)
  if (process.argv.includes("--open")) {
    const { default: open } = await import("open")
    open(url).catch(() => {})
  }
})
