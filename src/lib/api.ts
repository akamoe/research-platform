export interface Project {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
}
export interface NoteFile {
  path: string
  name: string
  updatedAt: string
  size: number
}
export type ProviderId = "openai" | "anthropic" | "openrouter" | "opencode-go"
export interface ProviderStatus {
  id: ProviderId
  label: string
  configured: boolean
  keyHint: string | null
  baseUrl: string
  defaultBaseUrl: string
}
export interface PublicSettings {
  providers: ProviderStatus[]
  defaultModel: { provider: ProviderId; model: string } | null
}
export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}
export type SourceType = "pdf" | "web" | "youtube" | "text" | "docx"
export interface Source {
  id: string
  title: string
  /** Missing means a PDF. */
  type?: SourceType
  url?: string
  author?: string
  fileName: string
  addedAt: string
  pages: number
  notePath: string
  hasText: boolean
  /** PDF pages that are scanned images, so their words can't be read yet (1-based). */
  scannedPages?: number[]
  /** False when the student left this paper out of the project chat. */
  inChat?: boolean
}
export interface SearchHit {
  kind: "source" | "note"
  /** Paper id, or note path. */
  ref: string
  title: string
  page: number
  chunk: number
  score: number
  /** Matched words are wrapped in « ». */
  snippet: string
}
export interface Passage {
  kind: "source" | "note"
  ref: string
  title: string
  page: number
  chunk: number
  text: string
}
export type HighlightColor = "yellow" | "green" | "blue" | "red" | "purple"
export interface PdfRect {
  origin: { x: number; y: number }
  size: { width: number; height: number }
}
export interface Highlight {
  id: string
  pageIndex: number
  rects: PdfRect[]
  color: HighlightColor
  text?: string
  image?: string
  createdAt: string
}
export interface ChatMeta {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model?: { provider: ProviderId; model: string }
  sourceId?: string
}
export interface KbPageMeta {
  id: string
  type: string
  title: string
  description: string
  tags: string[]
  sources: { id?: string; resource: string; title?: string }[]
  generated?: { by: string; at?: string }
  verified?: { by: string; at: string }[]
  status?: string
  contested?: boolean
}
export interface KbPage extends KbPageMeta {
  body: string
  raw: string
}
export interface KbFinding {
  kind: "contradiction" | "gap" | "duplicate" | "unsupported" | "broken-link" | "orphan" | "question"
  pages: string[]
  message: string
}
export interface KbStatus {
  pages: number
  notIngested: { id: string; title: string; running: boolean; error: string | null }[]
  running: { id: string; title: string }[]
}
export interface KbOverview {
  pages: KbPageMeta[]
  status: KbStatus
  lint: { at: string; findings: KbFinding[] } | null
}
export type CardKind = "note" | "question" | "claim" | "evidence" | "idea" | "quote" | "definition" | "task" | "source"
export interface CanvasCard {
  id: string
  text: string
  kind: CardKind
  kindBy?: "student" | "ai"
  x: number
  y: number
  createdAt: string
  updatedAt: string
  note?: string
  tags?: string[]
  pages?: string[]
  analyzedAt?: string
}
export interface CanvasLink {
  id: string
  from: string
  to: string
  relation: "supports" | "contradicts" | "related" | "answers" | "example-of"
  why: string
}
export interface CanvasShape {
  id: string
  type: "rect" | "ellipse" | "text" | "draw" | "arrow"
  x: number
  y: number
  w: number
  h: number
  color: string
  text?: string
  points?: [number, number][]
}
export interface CanvasArrow {
  id: string
  from: string
  to: string
  color: string
}
export interface CslName {
  family?: string
  given?: string
  literal?: string
}
/** A reference in CSL-JSON, keyed by its citation key. */
export interface Reference {
  id: string
  type: string
  title?: string
  author?: CslName[]
  editor?: CslName[]
  issued?: { "date-parts"?: (number | string)[][]; literal?: string }
  "container-title"?: string
  volume?: string
  issue?: string
  page?: string
  publisher?: string
  DOI?: string
  URL?: string
  ISBN?: string
  source?: string
  addedAt?: string
  [field: string]: unknown
}
export interface MatrixCell {
  text: string
  by: "ai" | "student"
  none?: boolean
  at?: string
}
export interface MatrixColumn {
  id: string
  name: string
  hint?: string
}
export interface Matrix {
  columns: MatrixColumn[]
  cells: Record<string, Record<string, MatrixCell>>
  hidden: string[]
}
export type ChapterStatus = "todo" | "drafting" | "revising" | "done"
export interface Chapter {
  id: string
  title: string
  doc?: { kind: "note" | "latex"; path: string }
  goal?: number
  due?: string
  status: ChapterStatus
}
export interface Milestone {
  id: string
  title: string
  due?: string
  done: boolean
}
export interface ThesisPlan {
  submission?: string
  goal?: number
  chapters: Chapter[]
  milestones: Milestone[]
}
export interface ThesisState {
  plan: ThesisPlan
  words: Record<string, number | null>
  total: number
  today: number
  week: number
}
export type DiscoverProvider = "openalex" | "s2" | "arxiv" | "crossref"
export interface Work {
  key: string
  title: string
  authors: string[]
  year?: number
  venue?: string
  doi?: string
  arxivId?: string
  abstract?: string
  citedBy?: number
  url?: string
  pdfUrl?: string
  type?: string
  from: DiscoverProvider[]
}
export interface RefCandidate {
  title: string
  authors: string
  year: string
  container: string
  doi: string
}
export interface CitationStyle {
  id: string
  title: string
}
export type CiteFormat = "bibliography" | "citation" | "bibtex" | "ris" | "csljson"

export interface CanvasData {
  cards: CanvasCard[]
  links: CanvasLink[]
  shapes?: CanvasShape[]
  arrows?: CanvasArrow[]
  synthesis?: { at: string; themes: { title: string; insight: string; cards: string[] }[]; questions: string[] }
  thinking?: boolean
}

export interface Chat extends ChatMeta {
  messages: ChatMessage[]
}

export interface LatexFile {
  path: string
  size: number
  text: boolean
  /** references.bib, rewritten from References on every compile. */
  library?: boolean
}
export interface LatexEngine {
  kind: "latexmk" | "tectonic"
  path: string
  bundled?: boolean
}
export interface LatexEngineStatus {
  engine: LatexEngine | null
  installable: boolean
  install: { done: number; total: number; error: string | null; running: boolean } | null
}
export interface Folder {
  id: string
  name: string
  section: "sources" | "notes"
  parent?: string
}
/** Stars and folders in the sidebar. Items are keyed "s:<sourceId>" or "n:<note path>". */
export interface Organize {
  starred: string[]
  folders: Folder[]
  placed: Record<string, string>
}
export interface LatexTemplate {
  id: string
  name: string
  publisher: string
  examples: string
  field: string
  cls: string
}
export interface LatexState extends LatexEngineStatus {
  files: LatexFile[]
  main: string
  /** When the PDF was last written, or null if there is none yet. */
  pdf: number | null
}
export interface LatexProblem {
  severity: "error" | "warning"
  file: string | null
  line: number | null
  message: string
}
export interface LatexResult {
  ok: boolean
  pdf: boolean
  fresh: boolean
  problems: LatexProblem[]
  log: string
  ms: number
  engine: LatexEngine["kind"]
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${url}`, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData) ? { "content-type": "application/json", ...init.headers } : init?.headers,
  })
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      msg = (await res.json()).error ?? msg
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })
const q = (path: string) => `?path=${encodeURIComponent(path)}`

export const api = {
  settings: () => request<PublicSettings>("/settings"),
  saveProvider: (id: ProviderId, body: { apiKey?: string; baseUrl?: string }) =>
    request<PublicSettings>(`/settings/providers/${id}`, json("PUT", body)),
  setDefaultModel: (provider: ProviderId, model: string) =>
    request<PublicSettings>("/settings/default-model", json("PUT", { provider, model })),
  models: (id: ProviderId) => request<{ models: string[] }>(`/models/${id}`),

  projects: () => request<Project[]>("/projects"),
  project: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (name: string, description: string) =>
    request<Project>("/projects", json("POST", { name, description })),
  updateProject: (id: string, patch: { name?: string; description?: string }) =>
    request<Project>(`/projects/${id}`, json("PATCH", patch)),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: "DELETE" }),

  notes: (id: string) => request<NoteFile[]>(`/projects/${id}/notes`),
  note: (id: string, path: string) => request<{ path: string; content: string }>(`/projects/${id}/note${q(path)}`),
  saveNote: (id: string, path: string, content: string) =>
    request(`/projects/${id}/note${q(path)}`, json("PUT", { content })),
  createNote: (id: string, name: string, content?: string) =>
    request<{ path: string }>(`/projects/${id}/notes`, json("POST", { name, content })),
  renameNote: (id: string, path: string, name: string, unique?: boolean) =>
    request<{ path: string }>(`/projects/${id}/note${q(path)}`, json("PATCH", { name, unique })),
  deleteNote: (id: string, path: string) => request(`/projects/${id}/note${q(path)}`, { method: "DELETE" }),

  chats: (id: string, sourceId?: string) =>
    request<ChatMeta[]>(`/projects/${id}/chats${sourceId ? `?source=${sourceId}` : ""}`),
  chat: (id: string, chatId: string) => request<Chat>(`/projects/${id}/chats/${chatId}`),
  sources: (id: string) => request<Source[]>(`/projects/${id}/sources`),
  source: (id: string, sid: string) => request<Source>(`/projects/${id}/sources/${sid}`),
  /** A PDF, Word, Markdown or text file. */
  uploadSource: (id: string, file: File) => {
    const form = new FormData()
    form.append("file", file)
    return request<Source>(`/projects/${id}/sources`, { method: "POST", body: form })
  },
  /** A web page, a YouTube video or a link to a PDF. */
  addSourceLink: (id: string, url: string) => request<Source>(`/projects/${id}/sources/link`, json("POST", { url })),
  addSourceText: (id: string, title: string, text: string) =>
    request<Source>(`/projects/${id}/sources/text`, json("POST", { title, text })),
  sourceText: (id: string, sid: string) => request<{ text: string }>(`/projects/${id}/sources/${sid}/text`),
  renameSource: (id: string, sid: string, title: string) =>
    request<Source>(`/projects/${id}/sources/${sid}`, json("PATCH", { title })),
  setSourceInChat: (id: string, sid: string, inChat: boolean) =>
    request<Source>(`/projects/${id}/sources/${sid}`, json("PATCH", { inChat })),
  search: (id: string, q: string, limit = 30) =>
    request<SearchHit[]>(`/projects/${id}/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  passage: (id: string, sid: string, page: number, chunk: number) =>
    request<Passage>(`/projects/${id}/sources/${sid}/passage?page=${page}&chunk=${chunk}`),
  deleteSource: (id: string, sid: string) => request(`/projects/${id}/sources/${sid}`, { method: "DELETE" }),
  latex: (id: string) => request<LatexState>(`/projects/${id}/latex`),
  latexFile: (id: string, path: string) =>
    request<{ content: string }>(`/projects/${id}/latex/file?path=${encodeURIComponent(path)}`),
  saveLatexFile: (id: string, path: string, content: string) =>
    request<{ ok: true }>(`/projects/${id}/latex/file?path=${encodeURIComponent(path)}`, json("PUT", { content })),
  createLatexFile: (id: string, path: string, content = "") =>
    request<LatexFile[]>(`/projects/${id}/latex/file`, json("POST", { path, content })),
  deleteLatexFile: (id: string, path: string) =>
    request<LatexFile[]>(`/projects/${id}/latex/file?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  uploadLatexFile: (id: string, file: File, folder = "") => {
    const form = new FormData()
    form.append("file", file)
    form.append("folder", folder)
    return request<LatexFile[]>(`/projects/${id}/latex/upload`, { method: "POST", body: form })
  },
  organize: (id: string) => request<Organize>(`/projects/${id}/organize`),
  saveOrganize: (id: string, o: Organize) => request<Organize>(`/projects/${id}/organize`, json("PUT", o)),
  latexTemplates: () => request<LatexTemplate[]>("/latex/templates"),
  applyLatexTemplate: (id: string, template: string) =>
    request<{ files: LatexFile[]; kept: string | null }>(`/projects/${id}/latex/template`, json("POST", { id: template })),
  compileLatex: (id: string) => request<LatexResult>(`/projects/${id}/latex/compile`, { method: "POST" }),
  latexPdfUrl: (id: string, version?: number | null, download = false) =>
    `/api/projects/${id}/latex/pdf?v=${version ?? 0}${download ? "&download=1" : ""}`,
  latexEngine: (id: string) => request<LatexEngineStatus>(`/projects/${id}/latex/engine`),
  installLatex: (id: string) => request<LatexEngineStatus>(`/projects/${id}/latex/engine/install`, { method: "POST" }),
  pdfUrl: (id: string, sid: string) => `/api/projects/${id}/sources/${sid}/pdf`,
  highlights: (id: string, sid: string) => request<Highlight[]>(`/projects/${id}/sources/${sid}/highlights`),
  addTextHighlight: (id: string, sid: string, h: { pageIndex: number; rects: PdfRect[]; color: HighlightColor; text: string }) =>
    request<Highlight>(`/projects/${id}/sources/${sid}/highlights`, json("POST", h)),
  addAreaHighlight: (id: string, sid: string, h: { pageIndex: number; rects: PdfRect[]; color: HighlightColor }, image: Blob) => {
    const form = new FormData()
    form.append("meta", JSON.stringify(h))
    form.append("image", image, "capture.png")
    return request<Highlight>(`/projects/${id}/sources/${sid}/highlights`, { method: "POST", body: form })
  },
  recolorHighlight: (id: string, sid: string, hid: string, color: HighlightColor) =>
    request<Highlight>(`/projects/${id}/sources/${sid}/highlights/${hid}`, json("PATCH", { color })),
  deleteHighlight: (id: string, sid: string, hid: string) =>
    request(`/projects/${id}/sources/${sid}/highlights/${hid}`, { method: "DELETE" }),
  assetUrl: (id: string, sid: string, file: string) => `/api/projects/${id}/sources/${sid}/assets/${file}`,

  deleteChat: (id: string, chatId: string) => request(`/projects/${id}/chats/${chatId}`, { method: "DELETE" }),

  knowledge: (id: string) => request<KbOverview>(`/projects/${id}/knowledge`),
  kbPage: (id: string, page: string) => request<KbPage>(`/projects/${id}/knowledge/page?page=${encodeURIComponent(page)}`),
  saveKbPage: (id: string, page: string, raw: string) =>
    request<KbPage>(`/projects/${id}/knowledge/page?page=${encodeURIComponent(page)}`, json("PUT", { raw })),
  reviewKbPage: (id: string, page: string) =>
    request<KbPage>(`/projects/${id}/knowledge/page/review?page=${encodeURIComponent(page)}`, { method: "POST" }),
  kbLog: (id: string) => request<{ content: string }>(`/projects/${id}/knowledge/log`),
  sourceSummary: (id: string, sid: string) =>
    request<{ page: KbPage | null; running: boolean; error: string | null }>(`/projects/${id}/sources/${sid}/summary`),
  ingest: (id: string, sourceIds?: string[]) =>
    request<KbStatus>(`/projects/${id}/knowledge/ingest`, json("POST", { sourceIds })),
  lintKnowledge: (id: string) => request<{ at: string; findings: KbFinding[] }>(`/projects/${id}/knowledge/lint`, { method: "POST" }),

  canvas: (id: string) => request<CanvasData>(`/projects/${id}/canvas`),
  addCard: (id: string, card: { text: string; x: number; y: number; kind?: CardKind }) =>
    request<CanvasCard>(`/projects/${id}/canvas/cards`, json("POST", card)),
  updateCard: (id: string, cardId: string, patch: { text?: string; x?: number; y?: number; kind?: CardKind }) =>
    request<CanvasCard>(`/projects/${id}/canvas/cards/${cardId}`, json("PATCH", patch)),
  removeCard: (id: string, cardId: string) => request(`/projects/${id}/canvas/cards/${cardId}`, { method: "DELETE" }),
  restoreCard: (id: string, cardId: string) =>
    request<CanvasCard>(`/projects/${id}/canvas/cards/${cardId}/restore`, { method: "POST" }),
  saveDrawing: (id: string, drawing: { shapes: CanvasShape[]; arrows: CanvasArrow[] }) =>
    request<{ shapes: CanvasShape[]; arrows: CanvasArrow[] }>(`/projects/${id}/canvas/drawing`, json("PUT", drawing)),
  think: (id: string) => request<CanvasData>(`/projects/${id}/canvas/think`, { method: "POST" }),
  matrix: (id: string) => request<Matrix>(`/projects/${id}/matrix`),
  saveMatrix: (id: string, m: Matrix) => request<Matrix>(`/projects/${id}/matrix`, json("PUT", m)),
  fillMatrix: (id: string, sourceId: string, columns?: string[], overwrite?: boolean) =>
    request<{ row: Record<string, MatrixCell>; filled: number }>(`/projects/${id}/matrix/fill`, json("POST", { sourceId, columns, overwrite })),
  thesis: (id: string) => request<ThesisState>(`/projects/${id}/thesis`),
  saveThesis: (id: string, plan: ThesisPlan) => request<ThesisState>(`/projects/${id}/thesis`, json("PUT", plan)),
  discoverSearch: (q: string, o: { provider: DiscoverProvider | "all"; from?: string; to?: string; oa?: boolean }) =>
    request<{ works: Work[]; failed: string[] }>(
      `/discover/search?${new URLSearchParams({ q, provider: o.provider, from: o.from ?? "", to: o.to ?? "", oa: o.oa ? "1" : "" })}`,
    ),
  discoverAround: (work: Work, relation: "related" | "citing" | "references") =>
    request<{ works: Work[] }>("/discover/around", json("POST", { work, relation })),
  discoverAdd: (id: string, work: Work, withPdf: boolean) =>
    request<{ reference: Reference; alreadyHad: boolean; source?: Source; pdfError?: string }>(
      `/projects/${id}/discover/add`,
      json("POST", { work, withPdf }),
    ),
  references: (id: string) => request<Reference[]>(`/projects/${id}/references`),
  addReferences: (id: string, text: string) =>
    request<{ added: Reference[]; existing: Reference[]; candidates?: RefCandidate[] }>(`/projects/${id}/references`, json("POST", { text })),
  restoreReferences: (id: string, items: Reference[]) =>
    request<{ added: Reference[] }>(`/projects/${id}/references/items`, json("POST", { items })),
  updateReference: (id: string, refId: string, patch: Partial<Reference>) =>
    request<Reference>(`/projects/${id}/references/${encodeURIComponent(refId)}`, json("PATCH", patch)),
  removeReference: (id: string, refId: string) =>
    request<Reference>(`/projects/${id}/references/${encodeURIComponent(refId)}`, { method: "DELETE" }),
  renderReferences: (
    id: string,
    body: { style?: string; format: CiteFormat; output?: "html" | "text"; ids?: string[]; notePath?: string },
  ) => request<{ text: string; ids?: string[] }>(`/projects/${id}/references/render`, json("POST", body)),
  citationStyles: (q: string) => request<CitationStyle[]>(`/citation-styles?q=${encodeURIComponent(q)}`),
}

/** Send a chat turn and receive the reply as it streams in. */
export async function streamChat(
  projectId: string,
  body: { chatId?: string; provider: ProviderId; model: string; messages: ChatMessage[]; openNotePath?: string; sourceId?: string },
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ chatId: string }> {
  const res = await fetch(`/api/projects/${projectId}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) {
    let msg = `Chat failed (${res.status})`
    try {
      msg = (await res.json()).error ?? msg
    } catch {}
    throw new Error(msg)
  }
  const chatId = res.headers.get("X-Chat-Id") ?? body.chatId ?? ""
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    const err = text.indexOf("\u0000")
    if (err >= 0) {
      onText(text.slice(0, err))
      throw new Error(text.slice(err + 1) || "The model stopped with an error")
    }
    onText(text)
  }
  return { chatId }
}
