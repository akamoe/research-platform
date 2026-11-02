// Color themes. The default ("Folio") lives in index.css; any other theme is
// written into a <style> tag that overrides those variables.
// Presets in tweakcn-presets.json come from tweakcn (github.com/jnsahaj/tweakcn, Apache-2.0).

export type ThemeVars = Record<string, string>
export type ThemeStyle = { id: string; label: string; light: ThemeVars; dark: ThemeVars }

export const DEFAULT_THEME_ID = "folio"
const STORAGE_KEY = "rp-theme-style"

const COLOR_KEYS = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted", "muted-foreground",
  "accent", "accent-foreground", "destructive", "border", "input", "ring",
  "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
]
const KEYS = new Set([...COLOR_KEYS, "radius", "font-sans", "font-serif", "font-mono"])
// Sidebar colors many themes leave out: borrow the matching base color.
const FALLBACK: Record<string, string> = {
  sidebar: "background",
  "sidebar-foreground": "foreground",
  "sidebar-primary": "primary",
  "sidebar-primary-foreground": "primary-foreground",
  "sidebar-accent": "accent",
  "sidebar-accent-foreground": "accent-foreground",
  "sidebar-border": "border",
  "sidebar-ring": "ring",
}
// Fonts go to --app-font-* so they do not collide with Tailwind's own --font-* variables.
const varName = (k: string) => (k.startsWith("font-") ? `--app-${k}` : `--${k}`)

export const BUILTIN_THEMES: ThemeStyle[] = [
  { id: DEFAULT_THEME_ID, label: "Folio", light: {}, dark: {} },
  {
    id: "neutral",
    label: "Neutral",
    light: {
      background: "oklch(0.995 0.002 90)", foreground: "oklch(0.2 0.005 90)", card: "oklch(1 0 0)",
      "card-foreground": "oklch(0.2 0.005 90)", popover: "oklch(1 0 0)", "popover-foreground": "oklch(0.2 0.005 90)",
      primary: "oklch(0.24 0.006 90)", "primary-foreground": "oklch(0.985 0 0)",
      secondary: "oklch(0.965 0.003 90)", "secondary-foreground": "oklch(0.24 0.006 90)",
      muted: "oklch(0.965 0.003 90)", "muted-foreground": "oklch(0.52 0.006 90)",
      accent: "oklch(0.955 0.004 90)", "accent-foreground": "oklch(0.24 0.006 90)",
      border: "oklch(0.915 0.004 90)", input: "oklch(0.915 0.004 90)", ring: "oklch(0.7 0.006 90)",
      sidebar: "oklch(0.98 0.003 90)", "sidebar-accent": "oklch(0.945 0.004 90)",
    },
    dark: {
      background: "oklch(0.17 0.003 90)", foreground: "oklch(0.93 0.004 90)", card: "oklch(0.21 0.003 90)",
      "card-foreground": "oklch(0.93 0.004 90)", popover: "oklch(0.21 0.003 90)", "popover-foreground": "oklch(0.93 0.004 90)",
      primary: "oklch(0.92 0.004 90)", "primary-foreground": "oklch(0.2 0.004 90)",
      secondary: "oklch(0.26 0.004 90)", "secondary-foreground": "oklch(0.93 0.004 90)",
      muted: "oklch(0.26 0.004 90)", "muted-foreground": "oklch(0.68 0.006 90)",
      accent: "oklch(0.27 0.004 90)", "accent-foreground": "oklch(0.93 0.004 90)",
      border: "oklch(1 0 0 / 9%)", input: "oklch(1 0 0 / 13%)", ring: "oklch(0.55 0.006 90)",
      sidebar: "oklch(0.19 0.003 90)", "sidebar-accent": "oklch(0.25 0.004 90)",
    },
  },
]

export async function loadTweakcnThemes(): Promise<ThemeStyle[]> {
  const mod = await import("./tweakcn-presets.json")
  const data = mod.default as Record<string, { label: string; light: ThemeVars; dark: ThemeVars }>
  return Object.entries(data).map(([id, t]) => ({ id: `tweakcn:${id}`, ...t }))
}

// A value may not break out of its declaration.
const safeValue = (v: string) => /^[^{};<>]{1,200}$/.test(v.trim())

function clean(vars: Record<string, unknown> | undefined): ThemeVars {
  const out: ThemeVars = {}
  for (const [k0, v] of Object.entries(vars ?? {})) {
    const k = k0.replace(/^--/, "")
    if (KEYS.has(k) && typeof v === "string" && safeValue(v)) out[k] = v.trim()
  }
  return out
}

/** Reads a theme pasted from tweakcn: the CSS from its Code panel, or a registry JSON. */
export function parseThemeText(text: string): ThemeStyle | null {
  const t = text.trim()
  let light: ThemeVars = {}
  let dark: ThemeVars = {}
  if (t.startsWith("{")) {
    try {
      const j = JSON.parse(t)
      const v = j.cssVars ?? j
      light = clean({ ...v.theme, ...v.light })
      dark = clean(v.dark)
    } catch {
      return null
    }
  } else {
    const blocks = t.matchAll(/(:root|\.dark)\s*\{([^}]*)\}/g)
    for (const [, sel, body] of blocks) {
      const vars: Record<string, string> = {}
      for (const [, k, v] of body.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) vars[k] = v
      if (sel === ":root") light = { ...light, ...clean(vars) }
      else dark = { ...dark, ...clean(vars) }
    }
  }
  if (!Object.keys(light).some((k) => COLOR_KEYS.includes(k))) return null
  return { id: "custom", label: "Custom", light, dark }
}

function block(selector: string, vars: ThemeVars) {
  const all = { ...vars }
  for (const [k, from] of Object.entries(FALLBACK)) if (!all[k] && all[from]) all[k] = all[from]
  const lines = Object.entries(all).map(([k, v]) => `  ${varName(k)}: ${v};`)
  return lines.length ? `${selector} {\n${lines.join("\n")}\n}\n` : ""
}

const SYSTEM_FONTS = /^(ui-|system-ui|-apple-system|sans-serif|serif|monospace|georgia|times|arial|helvetica|menlo|consolas|courier|segoe|roboto$|iowan|charter|palatino)/i

// Load a theme's fonts from Google Fonts. Offline, the system font fallback is used.
function loadFonts(style: ThemeStyle) {
  document.querySelectorAll("link[data-rp-font]").forEach((l) => l.remove())
  const families = new Set<string>()
  for (const k of ["font-sans", "font-serif", "font-mono"]) {
    const first = (style.light[k] ?? style.dark[k] ?? "").split(",")[0]?.trim().replace(/^["']|["']$/g, "")
    if (first && !SYSTEM_FONTS.test(first) && /^[\w ]+$/.test(first)) families.add(first)
  }
  for (const f of families) {
    const link = document.createElement("link")
    link.rel = "stylesheet"
    link.dataset.rpFont = f
    const fam = encodeURIComponent(f).replace(/%20/g, "+")
    link.href = `https://fonts.googleapis.com/css2?family=${fam}:wght@400;500;600;700&display=swap`
    // Not every font has all four weights; fall back to the regular one.
    link.onerror = () => {
      link.onerror = null
      link.href = `https://fonts.googleapis.com/css2?family=${fam}&display=swap`
    }
    document.head.appendChild(link)
  }
}

export function applyThemeStyle(style: ThemeStyle | null) {
  let tag = document.getElementById("rp-theme") as HTMLStyleElement | null
  if (!style || style.id === DEFAULT_THEME_ID) {
    tag?.remove()
    loadFonts({ id: "", label: "", light: {}, dark: {} })
    return
  }
  if (!tag) {
    tag = document.createElement("style")
    tag.id = "rp-theme"
    document.head.appendChild(tag)
  }
  // html:root / html.dark:root outrank the :root / .dark rules in index.css.
  tag.textContent = block("html:root", style.light) + block("html.dark:root", style.dark)
  loadFonts(style)
}

export function savedThemeStyle(): ThemeStyle | null {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    return s && typeof s.id === "string" ? { ...s, light: clean(s.light), dark: clean(s.dark) } : null
  } catch {
    return null
  }
}

export function saveThemeStyle(style: ThemeStyle) {
  try {
    if (style.id === DEFAULT_THEME_ID) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(style))
  } catch {
    // Storage full or blocked: the theme still applies for this visit.
  }
}

/** Three colors that identify a theme in the picker. */
export const swatches = (s: ThemeStyle, dark: boolean): string[] => {
  const v = dark ? { ...s.light, ...s.dark } : s.light
  return [v.background, v.primary, v.accent ?? v.secondary].map((c) => c ?? "transparent")
}
