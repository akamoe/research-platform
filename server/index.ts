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
  const body = z.object({ name: z.string() }).parse(await c.req.json())
  return c.json({ path: await projects.renameNote(c.req.param("id"), notePathParam(c), body.name) })
})
api.delete("/projects/:id/note", async (c) => {
  await projects.deleteNote(c.req.param("id"), notePathParam(c))
  return c.json({ ok: true })
})

// ---------- chat ----------
api.get("/projects/:id/chats", async (c) => c.json(await projects.listChats(c.req.param("id"))))
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
  const settings = await readSettings()
  const controller = new AbortController()
  const gen = streamChat({
    settings,
    provider,
    model: body.model,
    system: mentorPrompt({ project, noteTitles: notes.map((n) => n.path), openNote }),
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
  console.log(`\n  Research Platform running at ${url}`)
  console.log(`  Your files are in ${DATA_DIR}\n`)
  if (process.argv.includes("--open")) {
    const { default: open } = await import("open")
    open(url).catch(() => {})
  }
})
