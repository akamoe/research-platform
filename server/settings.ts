import fs from "node:fs/promises"
import { DATA_DIR, SETTINGS_FILE } from "./paths.ts"

export const PROVIDERS = ["openai", "anthropic", "openrouter", "opencode-go"] as const
export type ProviderId = (typeof PROVIDERS)[number]

export const PROVIDER_INFO: Record<ProviderId, { label: string; baseUrl: string; kind: "openai" | "anthropic" }> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", kind: "openai" },
  anthropic: { label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", kind: "anthropic" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", kind: "openai" },
  "opencode-go": { label: "OpenCode Go", baseUrl: "https://opencode.ai/zen/go/v1", kind: "openai" },
}

export interface ProviderSettings {
  apiKey?: string
  baseUrl?: string
}

export interface Settings {
  providers: Partial<Record<ProviderId, ProviderSettings>>
  defaultModel?: { provider: ProviderId; model: string }
}

export function isProvider(id: string): id is ProviderId {
  return (PROVIDERS as readonly string[]).includes(id)
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8"))
    return { providers: raw.providers ?? {}, defaultModel: raw.defaultModel }
  } catch {
    return { providers: {} }
  }
}

export async function writeSettings(s: Settings) {
  await fs.mkdir(DATA_DIR, { recursive: true })
  // Keys live only on this machine, readable only by the current user.
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2), { mode: 0o600 })
  await fs.chmod(SETTINGS_FILE, 0o600).catch(() => {})
}

/** Settings as the browser may see them: keys are never sent back, only whether one is set. */
export function publicSettings(s: Settings) {
  return {
    providers: PROVIDERS.map((id) => {
      const p = s.providers[id] ?? {}
      return {
        id,
        label: PROVIDER_INFO[id].label,
        configured: Boolean(p.apiKey),
        keyHint: p.apiKey ? `…${p.apiKey.slice(-4)}` : null,
        baseUrl: p.baseUrl || PROVIDER_INFO[id].baseUrl,
        defaultBaseUrl: PROVIDER_INFO[id].baseUrl,
      }
    }),
    defaultModel: s.defaultModel ?? null,
  }
}
