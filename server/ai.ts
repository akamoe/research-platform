import type { z } from "zod"
import { HttpError } from "./paths.ts"
import { streamChat } from "./llm.ts"
import { readSettings, type ProviderId } from "./settings.ts"

/**
 * Background AI work (knowledge base, canvas) uses the model the student last picked in chat.
 */
export async function backgroundModel() {
  const settings = await readSettings()
  const m = settings.defaultModel
  if (!m || !settings.providers[m.provider]?.apiKey) {
    throw new HttpError(400, "Pick a model in the chat first. The knowledge base and canvas use the same model.")
  }
  return { settings, provider: m.provider as ProviderId, model: m.model }
}

export async function complete(system: string, user: string, signal?: AbortSignal) {
  const { settings, provider, model } = await backgroundModel()
  let out = ""
  for await (const chunk of streamChat({ settings, provider, model, system, messages: [{ role: "user", content: user }], signal })) {
    out += chunk
  }
  return { text: out, actor: `research-platform/${model}` }
}

/** Pull the JSON object out of a model reply that may be wrapped in prose or code fences. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("The model did not return JSON")
  return JSON.parse(body.slice(start, end + 1))
}

/** Ask for JSON matching `schema`; if the reply doesn't parse, ask once more with the error. */
export async function completeJson<T>(system: string, user: string, schema: z.ZodType<T>) {
  let lastError = ""
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\nYour previous reply could not be used (${lastError}). Reply with only the JSON object.`
    const { text, actor } = await complete(system, prompt)
    try {
      return { data: schema.parse(extractJson(text)), actor }
    } catch (err) {
      lastError = (err as Error).message.slice(0, 300)
    }
  }
  throw new HttpError(502, `The model's answer couldn't be read (${lastError}). Try again, or pick a stronger model.`)
}
