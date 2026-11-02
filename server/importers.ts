import { Readability } from "@mozilla/readability"
import { parseHTML } from "linkedom"
import mammoth from "mammoth"
import { HttpError } from "./paths.ts"

/**
 * Turns things that aren't PDFs into readable text for a source: web pages, YouTube transcripts and
 * Word files. The text is light markdown (headings, lists, paragraphs), which the reader shows and
 * search indexes.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
const MAX_BYTES = 30 * 1024 * 1024
// Overridable so tests can point these at a local server.
const YOUTUBE = (process.env.RP_YOUTUBE_URL || "https://www.youtube.com").replace(/\/+$/, "")

export type Imported =
  | { kind: "pdf"; bytes: Uint8Array; fileName: string }
  | { kind: "text"; type: "web" | "youtube"; title: string; text: string; url: string; author?: string; doi?: string }

async function get(url: string, init: RequestInit = {}) {
  let res: Response
  try {
    res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(25_000),
      ...init,
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9", ...(init.headers ?? {}) },
    })
  } catch (err) {
    const msg = (err as Error).name === "TimeoutError" ? "took too long to answer" : "couldn't be reached"
    throw new HttpError(502, `That page ${msg}. Check the link and your internet connection.`)
  }
  if (!res.ok) throw new HttpError(502, `That page answered with an error (${res.status}).`)
  const len = Number(res.headers.get("content-length") ?? 0)
  if (len > MAX_BYTES) throw new HttpError(413, "That page is too large to import.")
  return res
}

export function youtubeId(url: string) {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www\.|m\.|music\.)/, "")
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.searchParams.get("v")) return u.searchParams.get("v")
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{6,})/)
      return m ? m[1] : null
    }
  } catch {}
  return null
}

/** A web page, a link to a PDF, or a YouTube video. */
export async function importLink(raw: string): Promise<Imported> {
  let url = raw.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  try {
    new URL(url)
  } catch {
    throw new HttpError(400, "That doesn't look like a link.")
  }
  const yt = youtubeId(url)
  if (yt) return importYoutube(yt)

  const res = await get(url)
  const type = res.headers.get("content-type") ?? ""
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(413, "That page is too large to import.")
  if (type.includes("pdf") || Buffer.from(bytes.subarray(0, 5)).toString("latin1") === "%PDF-") {
    const name = decodeURIComponent(new URL(res.url || url).pathname.split("/").pop() || "paper.pdf")
    return { kind: "pdf", bytes, fileName: name.toLowerCase().endsWith(".pdf") ? name : `${name}.pdf` }
  }
  if (!type.includes("html") && !type.includes("xml") && type) {
    if (type.startsWith("text/")) {
      const text = new TextDecoder().decode(bytes)
      return { kind: "text", type: "web", title: new URL(url).pathname.split("/").pop() || url, text, url }
    }
    throw new HttpError(415, "That link isn't a web page or a PDF.")
  }
  return fromHtml(new TextDecoder().decode(bytes), res.url || url)
}

function fromHtml(html: string, url: string): Imported {
  const { document } = parseHTML(html)
  const meta = (name: string) =>
    document.querySelector(`meta[name="${name}"], meta[property="${name}"]`)?.getAttribute("content")?.trim() || undefined
  const doi = meta("citation_doi") ?? meta("dc.identifier")?.replace(/^doi:/i, "")
  const article = new Readability(document as never, { charThreshold: 200 }).parse()
  const title = (meta("citation_title") ?? article?.title ?? meta("og:title") ?? document.title ?? url).trim()
  const text = article?.content ? htmlToMarkdown(article.content) : ""
  if (text.replace(/\s/g, "").length < 200)
    throw new HttpError(
      422,
      "Couldn't find readable text on that page. It may need a login or load its text with scripts. Copy the text and add it as a pasted source instead.",
    )
  return {
    kind: "text",
    type: "web",
    title,
    text,
    url,
    author: meta("citation_author") ?? article?.byline ?? meta("author") ?? undefined,
    doi: doi && /^10\.\d{4,9}\//.test(doi) ? doi : undefined,
  }
}

const BLOCK = new Set(
  "address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table tbody thead tfoot tr ul".split(
    " ",
  ),
)

interface DomNode {
  nodeType: number
  textContent: string | null
  childNodes: ArrayLike<DomNode>
  tagName?: string
}

/** Light markdown from HTML: headings, paragraphs, list items, quotes and code. Links and images are dropped. */
export function htmlToMarkdown(html: string) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`)
  const out: string[] = []
  let line = ""
  const flush = (prefix = "") => {
    const t = line.replace(/\s+/g, " ").trim()
    if (t) out.push(prefix + t)
    line = ""
  }
  const walk = (node: DomNode, prefix: string) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        line += child.textContent ?? ""
        continue
      }
      if (child.nodeType !== 1) continue
      const el = child
      const tag = (el.tagName ?? "").toLowerCase()
      if (["script", "style", "noscript", "svg", "button", "form", "iframe"].includes(tag)) continue
      if (tag === "br") {
        line += " "
        continue
      }
      if (/^h[1-6]$/.test(tag)) {
        flush(prefix)
        line = el.textContent ?? ""
        flush(`${"#".repeat(Math.max(2, Number(tag[1])))} `)
        continue
      }
      if (tag === "pre") {
        flush(prefix)
        const code = (el.textContent ?? "").replace(/\n+$/, "")
        if (code.trim()) out.push("```\n" + code + "\n```")
        continue
      }
      if (tag === "li") {
        flush(prefix)
        walk(el, prefix)
        flush(`${prefix}- `)
        continue
      }
      if (tag === "blockquote") {
        flush(prefix)
        walk(el, `${prefix}> `)
        flush(`${prefix}> `)
        continue
      }
      if (tag === "td" || tag === "th") {
        walk(el, prefix)
        line += " | "
        continue
      }
      if (BLOCK.has(tag)) {
        flush(prefix)
        walk(el, prefix)
        flush(prefix)
        continue
      }
      walk(el, prefix)
    }
  }
  walk(document.body as unknown as DomNode, "")
  flush()
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
}

// ---------- YouTube ----------

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))

function stamp(sec: number) {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const pad = (n: number) => String(n).padStart(2, "0")
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

interface Track {
  baseUrl: string
  languageCode: string
  kind?: string
}

function pickTrack(tracks: Track[]) {
  const en = (t: Track) => t.languageCode?.startsWith("en")
  return (
    tracks.find((t) => en(t) && t.kind !== "asr") ??
    tracks.find((t) => t.kind !== "asr") ??
    tracks.find(en) ??
    tracks[0]
  )
}

/** Caption lines from YouTube's timed-text XML (both the classic and the srv3 format). */
function parseCaptions(xml: string) {
  const lines: { start: number; text: string }[] = []
  for (const m of xml.matchAll(/<text start="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g))
    lines.push({ start: Number(m[1]), text: decodeEntities(decodeEntities(m[2]).replace(/<[^>]+>/g, "")) })
  if (!lines.length)
    for (const m of xml.matchAll(/<p t="(\d+)"[^>]*>([\s\S]*?)<\/p>/g))
      lines.push({ start: Number(m[1]) / 1000, text: decodeEntities(m[2].replace(/<[^>]+>/g, "")) })
  return lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, " ").trim() })).filter((l) => l.text)
}

/** Groups caption lines into ~45-second paragraphs, each starting with its timestamp. */
function transcriptText(lines: { start: number; text: string }[]) {
  const paras: string[] = []
  let cur: string[] = []
  let from = 0
  for (const l of lines) {
    if (!cur.length) from = l.start
    cur.push(l.text)
    if (l.start - from >= 45 && /[.?!]$/.test(l.text)) {
      paras.push(`[${stamp(from)}] ${cur.join(" ")}`)
      cur = []
    } else if (l.start - from >= 75) {
      paras.push(`[${stamp(from)}] ${cur.join(" ")}`)
      cur = []
    }
  }
  if (cur.length) paras.push(`[${stamp(from)}] ${cur.join(" ")}`)
  return paras.join("\n\n")
}

function jsonAfter(html: string, marker: string) {
  const at = html.indexOf(marker)
  if (at < 0) return null
  const start = html.indexOf("{", at)
  // Walk to the matching brace (strings may contain braces).
  let depth = 0
  let inStr = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (c === "\\") i++
      else if (c === '"') inStr = false
    } else if (c === '"') inStr = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

async function importYoutube(id: string): Promise<Imported> {
  const url = `https://www.youtube.com/watch?v=${id}`
  const html = await (await get(`${YOUTUBE}/watch?v=${id}&hl=en`, { headers: { Cookie: "CONSENT=YES+1" } })).text()
  const page = jsonAfter(html, "ytInitialPlayerResponse")
  const title: string = page?.videoDetails?.title ?? `YouTube video ${id}`
  const author: string | undefined = page?.videoDetails?.author
  const description: string = page?.videoDetails?.shortDescription ?? ""

  // The player API (as the Android app) hands out caption links that work without a browser token;
  // the watch page's own links are the fallback.
  let tracks: Track[] = []
  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1]
  if (key) {
    try {
      const res = await get(`${YOUTUBE}/youtubei/v1/player?key=${key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } }, videoId: id }),
      })
      const player = (await res.json()) as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: Track[] } } }
      tracks = player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
    } catch {}
  }
  if (!tracks.length) tracks = page?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []

  let lines: { start: number; text: string }[] = []
  const track = tracks.length ? pickTrack(tracks) : undefined
  if (track) {
    try {
      const capUrl = track.baseUrl.replace(/&fmt=[^&]*/, "")
      lines = parseCaptions(await (await get(capUrl.startsWith("http") ? capUrl : `${YOUTUBE}${capUrl}`)).text())
    } catch {}
  }
  if (!lines.length) {
    if (!page) throw new HttpError(502, "Couldn't open that YouTube video. Check the link.")
    throw new HttpError(
      422,
      "YouTube didn't share a transcript for that video (it may have no captions). You can paste a transcript as text instead.",
    )
  }
  const text = `${description.trim() ? `## Description\n\n${description.trim()}\n\n` : ""}## Transcript\n\n${transcriptText(lines)}`
  return { kind: "text", type: "youtube", title, text, url, author }
}

// ---------- files ----------

export async function importDocx(bytes: Uint8Array) {
  const { value } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) })
  const text = htmlToMarkdown(value)
  if (!text.trim()) throw new HttpError(422, "That Word file has no text in it.")
  return text
}
