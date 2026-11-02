import { HttpError } from "./paths.ts"
import { PROVIDER_INFO, type ProviderId, type Settings } from "./settings.ts"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

function resolve(settings: Settings, provider: ProviderId) {
  const p = settings.providers[provider]
  if (!p?.apiKey) throw new HttpError(400, `Add an API key for ${PROVIDER_INFO[provider].label} in Settings first.`)
  const info = PROVIDER_INFO[provider]
  return { apiKey: p.apiKey, baseUrl: (p.baseUrl || info.baseUrl).replace(/\/+$/, ""), kind: info.kind }
}

function headers(provider: ProviderId, apiKey: string, kind: "openai" | "anthropic") {
  if (kind === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" }
  }
  const h: Record<string, string> = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" }
  if (provider === "openrouter") {
    h["HTTP-Referer"] = "http://localhost"
    h["X-Title"] = "Folio"
  }
  return h
}

async function failure(res: Response, label: string): Promise<HttpError> {
  let detail = ""
  try {
    const body = await res.text()
    try {
      const j = JSON.parse(body)
      detail = j.error?.message ?? j.message ?? body
    } catch {
      detail = body
    }
  } catch {}
  return new HttpError(502, `${label} returned ${res.status}${detail ? `: ${String(detail).slice(0, 300)}` : ""}`)
}

export async function listModels(settings: Settings, provider: ProviderId): Promise<string[]> {
  const { apiKey, baseUrl, kind } = resolve(settings, provider)
  const url = kind === "anthropic" ? `${baseUrl}/models?limit=1000` : `${baseUrl}/models`
  const res = await fetch(url, { headers: headers(provider, apiKey, kind) })
  if (!res.ok) throw await failure(res, PROVIDER_INFO[provider].label)
  const json = (await res.json()) as { data?: { id: string }[] }
  return (json.data ?? []).map((m) => m.id).sort()
}

/** Read a server-sent-events body and yield each `data:` payload. */
async function* sse(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ""
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true })
    let idx
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line.startsWith("data:")) yield line.slice(5).trim()
    }
  }
}

export async function* streamChat(opts: {
  settings: Settings
  provider: ProviderId
  model: string
  system: string
  messages: ChatMessage[]
  signal?: AbortSignal
}): AsyncGenerator<string> {
  const { apiKey, baseUrl, kind } = resolve(opts.settings, opts.provider)
  const label = PROVIDER_INFO[opts.provider].label

  const body =
    kind === "anthropic"
      ? { model: opts.model, max_tokens: 4096, stream: true, system: opts.system, messages: opts.messages }
      : {
          model: opts.model,
          stream: true,
          messages: [{ role: "system", content: opts.system }, ...opts.messages],
        }
  const url = kind === "anthropic" ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`
  const res = await fetch(url, {
    method: "POST",
    headers: headers(opts.provider, apiKey, kind),
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) throw await failure(res, label)

  for await (const data of sse(res.body)) {
    if (data === "[DONE]") return
    let evt: any
    try {
      evt = JSON.parse(data)
    } catch {
      continue
    }
    if (kind === "anthropic") {
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") yield evt.delta.text
      if (evt.type === "error") throw new HttpError(502, `${label}: ${evt.error?.message ?? "stream error"}`)
    } else {
      if (evt.error) throw new HttpError(502, `${label}: ${evt.error.message ?? "stream error"}`)
      const text = evt.choices?.[0]?.delta?.content
      if (text) yield text
    }
  }
}
